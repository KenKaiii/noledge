import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";
import { embedTexts, toVectorBlob } from "@/lib/ai/embeddings/embed";
import type { Embedder } from "./ingest";

export type RetrievedChunk = {
	chunkId: string;
	documentId: string;
	documentTitle: string;
	content: string;
	distance: number;
};

export type RetrieveResult =
	| { ok: true; chunks: RetrievedChunk[] }
	| { ok: false; error: string };

export type RetrieveOptions = {
	db?: Database;
	embedder?: Embedder;
	topK?: number;
	/**
	 * Maximum cosine distance (0 = identical) for a chunk to be returned. Filters
	 * out clearly-unrelated matches so the model is not handed junk passages when
	 * the corpus has nothing relevant. `vec_chunks` uses cosine distance in
	 * `[0, 2]`; relevant matches typically score well under the default.
	 */
	maxDistance?: number;
	signal?: AbortSignal;
};

/** Default cosine-distance ceiling: keep relevant + borderline, drop the rest. */
const DEFAULT_MAX_DISTANCE = 0.85;

type Row = {
	chunk_id: string;
	document_id: string;
	document_title: string;
	content: string;
	distance: number;
};

/**
 * Retrieve the top-k most similar chunks for a query: embed the query → vec0 KNN
 * → join chunk + document metadata. Returns a `Result`.
 */
export async function retrieveChunks(
	query: string,
	options: RetrieveOptions = {},
): Promise<RetrieveResult> {
	const db = options.db ?? getDatabase();
	const embedder = options.embedder ?? embedTexts;
	const topK = options.topK ?? 5;
	const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;

	const trimmed = query.trim();
	if (trimmed.length === 0) return { ok: true, chunks: [] };

	const embedded = await embedder([trimmed], options.signal);
	if (!embedded.ok) return { ok: false, error: embedded.error };

	const queryVector = embedded.embeddings[0];
	if (!queryVector) return { ok: true, chunks: [] };

	try {
		const rows = db
			.prepare(
				`SELECT
					v.chunk_id   AS chunk_id,
					c.document_id AS document_id,
					d.title       AS document_title,
					c.content     AS content,
					v.distance    AS distance
				FROM vec_chunks v
				JOIN chunks c ON c.id = v.chunk_id
				JOIN documents d ON d.id = c.document_id
				WHERE v.embedding MATCH ? AND k = ?
				ORDER BY v.distance`,
			)
			.all(toVectorBlob(queryVector), topK) as Row[];

		return {
			ok: true,
			chunks: rows
				.filter((row) => row.distance <= maxDistance)
				.map((row) => ({
					chunkId: row.chunk_id,
					documentId: row.document_id,
					documentTitle: row.document_title,
					content: row.content,
					distance: row.distance,
				})),
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Retrieval failed.",
		};
	}
}
