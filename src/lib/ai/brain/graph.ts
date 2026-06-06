import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";

/**
 * A node is either a single chunk (the smallest unit of knowledge the brain
 * holds) or — for large libraries — a whole document aggregated into one
 * super-node. `level` on the graph says which. Grouping is by `documentId` so
 * the view can colour fragments by their source.
 */
export type BrainNode = {
	id: string;
	documentId: string;
	documentTitle: string;
	ordinal: number;
	preview: string;
	/** Chunk count for a document super-node; 1 for a chunk node. Drives radius. */
	size: number;
};

/**
 * `semantic` edges come from embedding similarity (meaning); `sequence` edges
 * connect consecutive chunks of one document (its narrative backbone).
 */
export type BrainLink = {
	source: string;
	target: string;
	weight: number;
	kind: "semantic" | "sequence";
};

export type BrainGraph = {
	nodes: BrainNode[];
	links: BrainLink[];
	documentCount: number;
	/** Granularity of the returned nodes: per-chunk or per-document super-nodes. */
	level: "chunk" | "document";
};

export type BuildBrainGraphOptions = {
	db?: Database;
	/** Minimum cosine similarity for a semantic edge. */
	minSimilarity?: number;
	/** Maximum edges retained per node, keeping the strongest. */
	maxDegree?: number;
	/**
	 * Override the chunk→document level-of-detail threshold. Above this many
	 * chunks the graph aggregates per document instead of per chunk. Mainly for
	 * tests; production uses the default.
	 */
	chunkLodThreshold?: number;
};

/**
 * Above this many chunks the per-chunk view is abandoned for a per-document
 * super-node view — no 3D force-graph renders 100k interactive nodes. Below it,
 * the detailed chunk view (with sqlite-vec KNN edges) stays fast.
 */
export const CHUNK_LOD_THRESHOLD = 1500;
/** Hard cap on returned nodes regardless of level — a final safety valve. */
export const MAX_NODES = 2000;
const DEFAULT_MIN_SIMILARITY = 0.6;
const DEFAULT_MAX_DEGREE = 6;

type ChunkRow = {
	id: string;
	document_id: string;
	document_title: string;
	ordinal: number;
	content: string;
	embedding: Buffer;
};

type DocChunkRow = {
	document_id: string;
	document_title: string;
	embedding: Buffer;
};

/** Read a sqlite-vec `float[]` blob column back into a typed array. */
function blobToVector(blob: Buffer): Float32Array {
	return new Float32Array(
		blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
	);
}

/** Return an L2-normalized copy. A zero vector is returned unchanged. */
function normalized(vector: Float32Array): Float32Array {
	let sumSquares = 0;
	for (const value of vector) sumSquares += value * value;
	const magnitude = Math.sqrt(sumSquares);
	if (magnitude === 0) return vector;
	const out = new Float32Array(vector.length);
	for (let i = 0; i < vector.length; i += 1)
		out[i] = (vector[i] ?? 0) / magnitude;
	return out;
}

/** Dot product of two unit vectors == cosine similarity. */
function dot(a: Float32Array, b: Float32Array): number {
	let total = 0;
	for (let i = 0; i < a.length; i += 1) total += (a[i] ?? 0) * (b[i] ?? 0);
	return total;
}

/** Trim a chunk down to a short, single-line preview for tooltips. */
function previewOf(content: string): string {
	const flat = content.replace(/\s+/g, " ").trim();
	return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}

function edgeKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Cheap signature of the corpus: any insert or delete moves at least one of
 * these, so a matching signature means the built graph is still valid.
 */
type CorpusSignature = {
	chunkCount: number;
	documentCount: number;
	maxRowid: number;
	minSimilarity: number;
	maxDegree: number;
	chunkLodThreshold: number;
};

function corpusSignature(
	db: Database,
	minSimilarity: number,
	maxDegree: number,
	chunkLodThreshold: number,
): CorpusSignature {
	const row = db
		.prepare(
			`SELECT
				(SELECT COUNT(*) FROM chunks)                  AS chunkCount,
				(SELECT COUNT(*) FROM documents)               AS documentCount,
				(SELECT COALESCE(MAX(rowid), 0) FROM chunks)   AS maxRowid`,
		)
		.get() as { chunkCount: number; documentCount: number; maxRowid: number };
	return {
		chunkCount: row.chunkCount,
		documentCount: row.documentCount,
		maxRowid: row.maxRowid,
		minSimilarity,
		maxDegree,
		chunkLodThreshold,
	};
}

function signaturesEqual(a: CorpusSignature, b: CorpusSignature): boolean {
	return (
		a.chunkCount === b.chunkCount &&
		a.documentCount === b.documentCount &&
		a.maxRowid === b.maxRowid &&
		a.minSimilarity === b.minSimilarity &&
		a.maxDegree === b.maxDegree &&
		a.chunkLodThreshold === b.chunkLodThreshold
	);
}

// Module-level memo keyed by the corpus signature. Ingest/delete change the
// signature, so the cache self-invalidates without explicit wiring.
let cache: { signature: CorpusSignature; graph: BrainGraph } | null = null;

/**
 * Build the knowledge graph for "The Brain", adapting granularity to corpus
 * size. The built graph is memoized on a cheap corpus signature so revisiting
 * the view does not rebuild it.
 *
 *  - Small libraries (≤ `CHUNK_LOD_THRESHOLD` chunks) get the detailed chunk
 *    view: a sequence backbone plus semantic edges from sqlite-vec KNN.
 *  - Large libraries collapse to one super-node per document, with semantic
 *    edges between document centroids — the only thing that scales to 100k+.
 */
export function buildBrainGraph(
	options: BuildBrainGraphOptions = {},
): BrainGraph {
	const db = options.db ?? getDatabase();
	const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
	const maxDegree = options.maxDegree ?? DEFAULT_MAX_DEGREE;
	const chunkLodThreshold = options.chunkLodThreshold ?? CHUNK_LOD_THRESHOLD;

	const signature = corpusSignature(
		db,
		minSimilarity,
		maxDegree,
		chunkLodThreshold,
	);
	if (cache && signaturesEqual(cache.signature, signature)) {
		return cache.graph;
	}

	const graph =
		signature.chunkCount > chunkLodThreshold
			? buildDocumentGraph(db, minSimilarity, maxDegree)
			: buildChunkGraph(db, minSimilarity, maxDegree);

	cache = { signature, graph };
	return graph;
}

/**
 * Detailed per-chunk view. Every chunk is a node; consecutive chunks of a
 * document form a sequence backbone, and semantic edges come from sqlite-vec
 * KNN (native C scan) rather than a JS O(n²) pairwise loop.
 */
function buildChunkGraph(
	db: Database,
	minSimilarity: number,
	maxDegree: number,
): BrainGraph {
	const rows = db
		.prepare(
			`SELECT
				c.id          AS id,
				c.document_id AS document_id,
				d.title       AS document_title,
				c.ordinal     AS ordinal,
				c.content     AS content,
				v.embedding   AS embedding
			FROM chunks c
			JOIN documents d ON d.id = c.document_id
			JOIN vec_chunks v ON v.chunk_id = c.id
			ORDER BY d.created_at ASC, c.ordinal ASC`,
		)
		.all() as ChunkRow[];

	if (rows.length === 0) {
		return { nodes: [], links: [], documentCount: 0, level: "chunk" };
	}

	const nodes: BrainNode[] = rows.map((row) => ({
		id: row.id,
		documentId: row.document_id,
		documentTitle: row.document_title,
		ordinal: row.ordinal,
		preview: previewOf(row.content),
		size: 1,
	}));

	const links: BrainLink[] = [];
	const seen = new Set<string>();
	const degree = new Map<string, number>();
	const bump = (id: string): void => {
		degree.set(id, (degree.get(id) ?? 0) + 1);
	};

	// 1. Sequence backbone: link consecutive chunks within the same document.
	for (let i = 1; i < rows.length; i += 1) {
		const prev = rows[i - 1];
		const curr = rows[i];
		if (!prev || !curr || prev.document_id !== curr.document_id) continue;
		const key = edgeKey(prev.id, curr.id);
		seen.add(key);
		links.push({
			source: prev.id,
			target: curr.id,
			weight: 1,
			kind: "sequence",
		});
		bump(prev.id);
		bump(curr.id);
	}

	// 2. Semantic edges via KNN: for each chunk, ask sqlite-vec for its nearest
	//    neighbours and keep those above the similarity floor. KNN is asymmetric,
	//    so canonicalize/dedupe pairs with edgeKey + seen.
	const knn = db.prepare(
		`SELECT v.chunk_id AS chunk_id, v.distance AS distance
		FROM vec_chunks v
		WHERE v.embedding MATCH ? AND k = ?
		ORDER BY v.distance`,
	);
	const candidates: BrainLink[] = [];
	const k = maxDegree + 1; // +1 so the chunk's own (distance 0) hit can be skipped
	for (const row of rows) {
		const neighbors = knn.all(row.embedding, k) as {
			chunk_id: string;
			distance: number;
		}[];
		for (const neighbor of neighbors) {
			if (neighbor.chunk_id === row.id) continue;
			const key = edgeKey(row.id, neighbor.chunk_id);
			if (seen.has(key)) continue;
			seen.add(key);
			const weight = 1 - neighbor.distance; // cosine distance → similarity
			if (weight >= minSimilarity) {
				candidates.push({
					source: row.id,
					target: neighbor.chunk_id,
					weight,
					kind: "semantic",
				});
			}
		}
	}

	// Strongest first, then cap per-node degree to avoid a hairball.
	candidates.sort((x, y) => y.weight - x.weight);
	for (const link of candidates) {
		if ((degree.get(link.source) ?? 0) >= maxDegree) continue;
		if ((degree.get(link.target) ?? 0) >= maxDegree) continue;
		links.push(link);
		bump(link.source);
		bump(link.target);
	}

	const documentCount = new Set(rows.map((row) => row.document_id)).size;
	return { nodes, links, documentCount, level: "chunk" };
}

type DocAccumulator = {
	documentId: string;
	documentTitle: string;
	sum: Float32Array;
	count: number;
};

/**
 * Aggregated per-document view for large libraries. One node per document sized
 * by its chunk count; semantic edges connect documents whose normalized
 * centroid embeddings are similar. Sequence edges are dropped — they are not
 * meaningful between whole documents.
 */
function buildDocumentGraph(
	db: Database,
	minSimilarity: number,
	maxDegree: number,
): BrainGraph {
	const rows = db
		.prepare(
			`SELECT
				c.document_id AS document_id,
				d.title       AS document_title,
				v.embedding   AS embedding
			FROM chunks c
			JOIN documents d ON d.id = c.document_id
			JOIN vec_chunks v ON v.chunk_id = c.id
			ORDER BY d.created_at ASC, c.ordinal ASC`,
		)
		.iterate() as IterableIterator<DocChunkRow>;

	// Single linear pass: accumulate a centroid (vector sum) and chunk count per
	// document. Insertion order tracks document order (rows are created_at sorted).
	const byDoc = new Map<string, DocAccumulator>();
	for (const row of rows) {
		const vector = blobToVector(row.embedding);
		let acc = byDoc.get(row.document_id);
		if (!acc) {
			acc = {
				documentId: row.document_id,
				documentTitle: row.document_title,
				sum: new Float32Array(vector.length),
				count: 0,
			};
			byDoc.set(row.document_id, acc);
		}
		for (let i = 0; i < vector.length; i += 1) {
			acc.sum[i] = (acc.sum[i] ?? 0) + (vector[i] ?? 0);
		}
		acc.count += 1;
	}

	if (byDoc.size === 0) {
		return { nodes: [], links: [], documentCount: 0, level: "document" };
	}

	// Largest documents first, capped — they anchor the map and bound the work.
	const docs = [...byDoc.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, MAX_NODES);

	const centroids = docs.map((doc) => normalized(doc.sum));
	const nodes: BrainNode[] = docs.map((doc) => ({
		id: doc.documentId,
		documentId: doc.documentId,
		documentTitle: doc.documentTitle,
		ordinal: 0,
		preview: `${doc.documentTitle} · ${doc.count} chunk${
			doc.count === 1 ? "" : "s"
		}`,
		size: doc.count,
	}));

	const links: BrainLink[] = [];
	const seen = new Set<string>();
	const degree = new Map<string, number>();

	// Inter-document semantic edges. The document set is small relative to chunk
	// count, so bounded pairwise over centroids is cheap and exact.
	const candidates: BrainLink[] = [];
	for (let i = 0; i < docs.length; i += 1) {
		const a = centroids[i];
		const docA = docs[i];
		if (!a || !docA) continue;
		for (let j = i + 1; j < docs.length; j += 1) {
			const b = centroids[j];
			const docB = docs[j];
			if (!b || !docB) continue;
			const weight = dot(a, b);
			if (weight >= minSimilarity) {
				candidates.push({
					source: docA.documentId,
					target: docB.documentId,
					weight,
					kind: "semantic",
				});
			}
		}
	}

	candidates.sort((x, y) => y.weight - x.weight);
	for (const link of candidates) {
		if ((degree.get(link.source) ?? 0) >= maxDegree) continue;
		if ((degree.get(link.target) ?? 0) >= maxDegree) continue;
		const key = edgeKey(link.source, link.target);
		if (seen.has(key)) continue;
		seen.add(key);
		links.push(link);
		degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
		degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
	}

	return { nodes, links, documentCount: byDoc.size, level: "document" };
}
