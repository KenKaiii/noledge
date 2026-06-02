import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";

/**
 * A node is a single chunk — the smallest unit of knowledge the brain holds.
 * Grouping is by `documentId` so the view can colour fragments by their source.
 */
export type BrainNode = {
	id: string;
	documentId: string;
	documentTitle: string;
	ordinal: number;
	preview: string;
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
};

export type BuildBrainGraphOptions = {
	db?: Database;
	/** Minimum cosine similarity for a semantic edge. */
	minSimilarity?: number;
	/** Maximum edges retained per node, keeping the strongest. */
	maxDegree?: number;
};

type ChunkRow = {
	id: string;
	document_id: string;
	document_title: string;
	ordinal: number;
	content: string;
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
 * Build the knowledge graph for "The Brain". Every chunk across every document
 * is a node. Connections form two ways:
 *
 *  1. Sequence — consecutive chunks of a document are linked, so even a single
 *     upload appears as a connected train of thought rather than loose dots.
 *  2. Semantic — any two chunks whose embeddings exceed `minSimilarity` are
 *     linked, which is how separate documents fuse into one brain wherever their
 *     ideas overlap.
 *
 * Semantic edges are scored strongest-first and thinned so each node keeps at
 * most `maxDegree` connections, preventing a hairball while preserving clusters.
 *
 * Note: pairwise scoring is O(n²) over chunks; fine for a local single-user
 * library. Revisit with an ANN index if chunk counts reach tens of thousands.
 */
export function buildBrainGraph(
	options: BuildBrainGraphOptions = {},
): BrainGraph {
	const db = options.db ?? getDatabase();
	const minSimilarity = options.minSimilarity ?? 0.6;
	const maxDegree = options.maxDegree ?? 6;

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
		return { nodes: [], links: [], documentCount: 0 };
	}

	const nodes: BrainNode[] = rows.map((row) => ({
		id: row.id,
		documentId: row.document_id,
		documentTitle: row.document_title,
		ordinal: row.ordinal,
		preview: previewOf(row.content),
	}));

	const vectors = rows.map((row) => normalized(blobToVector(row.embedding)));

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

	// 2. Semantic edges: score every distinct pair, keep those above the floor.
	const candidates: BrainLink[] = [];
	for (let i = 0; i < vectors.length; i += 1) {
		const a = vectors[i];
		const nodeA = nodes[i];
		if (!a || !nodeA) continue;
		for (let j = i + 1; j < vectors.length; j += 1) {
			const b = vectors[j];
			const nodeB = nodes[j];
			if (!b || !nodeB) continue;
			if (seen.has(edgeKey(nodeA.id, nodeB.id))) continue;
			const weight = dot(a, b);
			if (weight >= minSimilarity) {
				candidates.push({
					source: nodeA.id,
					target: nodeB.id,
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
	return { nodes, links, documentCount };
}
