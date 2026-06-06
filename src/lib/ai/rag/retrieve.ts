import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";
import { embedTexts, toVectorBlob } from "@/lib/ai/embeddings/embed";
import type { Embedder } from "./ingest";
import { keywordSearch } from "./keyword";
import { mmrRerank } from "./mmr";
import {
	getConfiguredReranker,
	identityReranker,
	type Reranker,
} from "./rerank";

export type RetrievedChunk = {
	chunkId: string;
	documentId: string;
	documentTitle: string;
	content: string;
	/** Best cosine distance from the vector arm (0 = identical). Infinity if the
	 * chunk surfaced only via the keyword arm. */
	distance: number;
	/** Combined normalized relevance score in `[0, 1]` (higher = better). */
	score: number;
	/** Char offset of the chunk's start in the source document, if recorded. */
	start?: number;
	/** Char offset of the chunk's end in the source document, if recorded. */
	end?: number;
	/** When this document was ingested into the knowledge base. */
	documentCreatedAt: number;
	/** Publication timestamp from the upstream source, when available. */
	documentPublishedAt?: number;
	/** Date used for filtering/sorting semantics: publishedAt when known, else createdAt. */
	documentDate: number;
};

export type RetrieveResult =
	| { ok: true; chunks: RetrievedChunk[] }
	| { ok: false; error: string };

export type RetrieveOptions = {
	db?: Database;
	embedder?: Embedder;
	topK?: number;
	/**
	 * Minimum combined score (`[0, 1]`) for a chunk to be returned. Filters out
	 * clearly-unrelated matches. Defaults to a permissive 0.3.
	 */
	minScore?: number;
	/**
	 * Back-compat: maximum cosine distance for the vector arm. When provided it
	 * overrides `minScore` with `1 - maxDistance` so existing distance-based
	 * callers keep their behavior.
	 */
	maxDistance?: number;
	/** Weight of the semantic (vector) arm before normalization. Default 0.7. */
	vectorWeight?: number;
	/** Weight of the keyword (FTS5) arm before normalization. Default 0.3. */
	textWeight?: number;
	/** Run the FTS5 keyword arm and fuse it with vectors. Default true. */
	hybrid?: boolean;
	/** Apply MMR diversity reranking before the final top-k slice. Default true. */
	mmr?: boolean;
	/** Final reordering pass. Defaults to a no-op identity reranker. */
	reranker?: Reranker;
	/** Inclusive lower bound over published_at when known, otherwise created_at. */
	dateFrom?: number;
	/** Inclusive upper bound over published_at when known, otherwise created_at. */
	dateTo?: number;
	signal?: AbortSignal;
};

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SCORE = 0.3;
/** Candidate pool size handed to a real reranker before MMR/top-k slicing. */
const RERANK_POOL_SIZE = 30;
const DEFAULT_VECTOR_WEIGHT = 0.7;
const DEFAULT_TEXT_WEIGHT = 0.3;

type VectorRow = {
	chunk_id: string;
	document_id: string;
	document_title: string;
	content: string;
	distance: number;
	start: number | null;
	end: number | null;
	created_at: number;
	published_at: number | null;
	document_date: number;
};

type ChunkRow = {
	id: string;
	document_id: string;
	document_title: string;
	content: string;
	start: number | null;
	end: number | null;
	created_at: number;
	published_at: number | null;
	document_date: number;
};

type Candidate = {
	chunkId: string;
	documentId: string;
	documentTitle: string;
	content: string;
	distance: number;
	start: number | null;
	end: number | null;
	createdAt: number;
	publishedAt: number | null;
	documentDate: number;
	vScore: number;
	tScore: number;
};

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

/** Candidate overfetch per arm so filtering/MMR never under-fills `topK`. */
function candidateCount(topK: number): number {
	return Math.max(topK * 3, topK + 8);
}

function buildDateWhere(options: RetrieveOptions): {
	clause: string;
	params: number[];
} {
	const filters: string[] = [];
	const params: number[] = [];
	if (options.dateFrom !== undefined) {
		filters.push("COALESCE(d.published_at, d.created_at) >= ?");
		params.push(options.dateFrom);
	}
	if (options.dateTo !== undefined) {
		filters.push("COALESCE(d.published_at, d.created_at) <= ?");
		params.push(options.dateTo);
	}
	return {
		clause: filters.length > 0 ? ` AND ${filters.join(" AND ")}` : "",
		params,
	};
}

/**
 * Retrieve the top-k most relevant chunks for a query via hybrid keyword+vector
 * retrieval: overfetch candidates from each arm, normalize and fuse their scores,
 * filter by `minScore`, diversify with MMR, slice to `topK`, then rerank. Returns
 * a `Result`.
 */
export async function retrieveChunks(
	query: string,
	options: RetrieveOptions = {},
): Promise<RetrieveResult> {
	const db = options.db ?? getDatabase();
	const embedder = options.embedder ?? embedTexts;
	const topK = options.topK ?? DEFAULT_TOP_K;
	const hybrid = options.hybrid ?? true;
	const useMmr = options.mmr ?? true;
	const reranker = options.reranker ?? getConfiguredReranker(options.db);

	const minScore =
		options.maxDistance !== undefined
			? clamp01(1 - options.maxDistance)
			: (options.minScore ?? DEFAULT_MIN_SCORE);

	// Normalize weights so they sum to 1 (mirror the reference clamp logic).
	const rawVectorWeight = Math.max(
		0,
		options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT,
	);
	const rawTextWeight = Math.max(0, options.textWeight ?? DEFAULT_TEXT_WEIGHT);
	const weightSum = rawVectorWeight + rawTextWeight;
	const vectorWeight = weightSum === 0 ? 1 : rawVectorWeight / weightSum;
	const textWeight = weightSum === 0 ? 0 : rawTextWeight / weightSum;

	const trimmed = query.trim();
	if (trimmed.length === 0) return { ok: true, chunks: [] };

	const embedded = await embedder([trimmed], options.signal);
	if (!embedded.ok) return { ok: false, error: embedded.error };

	const queryVector = embedded.embeddings[0];
	if (!queryVector) return { ok: true, chunks: [] };

	const candidateK = candidateCount(topK);
	const dateWhere = buildDateWhere(options);

	try {
		const candidates = new Map<string, Candidate>();

		// Vector arm: KNN overfetch → vScore = clamp01(1 - cosineDistance).
		const vectorRows = db
			.prepare(
				`SELECT
					v.chunk_id    AS chunk_id,
					c.document_id AS document_id,
					d.title       AS document_title,
					c.content                         AS content,
					v.distance                        AS distance,
					c.start                           AS start,
					c.end                             AS end,
					d.created_at                      AS created_at,
					d.published_at                    AS published_at,
					COALESCE(d.published_at, d.created_at) AS document_date
				FROM vec_chunks v
				JOIN chunks c ON c.id = v.chunk_id
				JOIN documents d ON d.id = c.document_id
				WHERE v.embedding MATCH ? AND k = ?${dateWhere.clause}
				ORDER BY v.distance`,
			)
			.all(
				toVectorBlob(queryVector),
				candidateK,
				...dateWhere.params,
			) as VectorRow[];

		for (const row of vectorRows) {
			candidates.set(row.chunk_id, {
				chunkId: row.chunk_id,
				documentId: row.document_id,
				documentTitle: row.document_title,
				content: row.content,
				distance: row.distance,
				start: row.start,
				end: row.end,
				createdAt: row.created_at,
				publishedAt: row.published_at,
				documentDate: row.document_date,
				vScore: clamp01(1 - row.distance),
				tScore: 0,
			});
		}

		// Keyword arm: FTS5 overfetch → min-max normalized rank → tScore.
		if (hybrid) {
			const hits = keywordSearch(db, trimmed, candidateK, {
				...(options.dateFrom !== undefined
					? { dateFrom: options.dateFrom }
					: {}),
				...(options.dateTo !== undefined ? { dateTo: options.dateTo } : {}),
			});
			if (hits.length > 0) {
				const ranks = hits.map((hit) => hit.rank);
				const minRank = Math.min(...ranks);
				const maxRank = Math.max(...ranks);
				const span = maxRank - minRank;

				const getChunk = db.prepare(
					`SELECT
						c.id          AS id,
						c.document_id AS document_id,
						d.title       AS document_title,
						c.content                         AS content,
						c.start                           AS start,
						c.end                             AS end,
						d.created_at                      AS created_at,
						d.published_at                    AS published_at,
						COALESCE(d.published_at, d.created_at) AS document_date
					FROM chunks c
					JOIN documents d ON d.id = c.document_id
					WHERE c.id = ?${dateWhere.clause}`,
				);

				for (const hit of hits) {
					// More negative rank = better; map best → 1, worst → 0.
					const tScore = span === 0 ? 1 : (maxRank - hit.rank) / span;
					const existing = candidates.get(hit.chunkId);
					if (existing) {
						existing.tScore = tScore;
						continue;
					}
					const row = getChunk.get(hit.chunkId, ...dateWhere.params) as
						| ChunkRow
						| undefined;
					if (!row) continue;
					candidates.set(hit.chunkId, {
						chunkId: row.id,
						documentId: row.document_id,
						documentTitle: row.document_title,
						content: row.content,
						distance: Number.POSITIVE_INFINITY,
						start: row.start,
						end: row.end,
						createdAt: row.created_at,
						publishedAt: row.published_at,
						documentDate: row.document_date,
						vScore: 0,
						tScore,
					});
				}
			}
		}

		// Fuse → filter by minScore → sort by combined score.
		const scored = [...candidates.values()]
			.map((candidate) => ({
				candidate,
				score: vectorWeight * candidate.vScore + textWeight * candidate.tScore,
			}))
			.filter((entry) => entry.score >= minScore)
			.sort((a, b) => b.score - a.score);

		type ScoredEntry = (typeof scored)[number];

		const toRetrievedChunk = (entry: ScoredEntry): RetrievedChunk => ({
			chunkId: entry.candidate.chunkId,
			documentId: entry.candidate.documentId,
			documentTitle: entry.candidate.documentTitle,
			content: entry.candidate.content,
			distance: entry.candidate.distance,
			score: entry.score,
			...(entry.candidate.start !== null
				? { start: entry.candidate.start }
				: {}),
			...(entry.candidate.end !== null ? { end: entry.candidate.end } : {}),
			documentCreatedAt: entry.candidate.createdAt,
			...(entry.candidate.publishedAt !== null
				? { documentPublishedAt: entry.candidate.publishedAt }
				: {}),
			documentDate: entry.candidate.documentDate,
		});

		const sliceFinal = (entries: ScoredEntry[]): ScoredEntry[] =>
			useMmr
				? mmrRerank(
						entries.map((entry) => ({
							score: entry.score,
							content: entry.candidate.content,
							entry,
						})),
						{ limit: topK },
					).map((item) => item.entry)
				: entries.slice(0, topK);

		// When a real reranker is active, rerank the larger candidate pool first so a
		// strong passage outside the naive top-k can be promoted, then MMR/slice over
		// the reranked order. The identity (default) path stays byte-for-byte
		// identical to today: MMR/slice the fused order directly.
		if (reranker !== identityReranker) {
			const pool = scored.slice(0, Math.min(RERANK_POOL_SIZE, scored.length));
			const poolChunks = pool.map(toRetrievedChunk);
			const rerankedPool = await reranker(trimmed, poolChunks, options.signal);

			// Map reranked chunks back to scored entries, applying the rerank score.
			const byChunkId = new Map(
				pool.map((entry) => [entry.candidate.chunkId, entry]),
			);
			const rerankedEntries: ScoredEntry[] = [];
			for (const chunk of rerankedPool) {
				const entry = byChunkId.get(chunk.chunkId);
				if (!entry) continue;
				rerankedEntries.push({
					candidate: entry.candidate,
					score: chunk.score,
				});
			}

			const selected = sliceFinal(rerankedEntries);
			return { ok: true, chunks: selected.map(toRetrievedChunk) };
		}

		const selected = sliceFinal(scored);
		return { ok: true, chunks: selected.map(toRetrievedChunk) };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Retrieval failed.",
		};
	}
}
