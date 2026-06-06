import type { Database } from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/ai/db/client";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/db/schema";
import { toVectorBlob } from "@/lib/ai/embeddings/embed";
import { buildBrainGraph } from "./graph";

let db: Database | null = null;

afterEach(() => {
	db?.close();
	db = null;
});

/** A unit vector pointing along a single axis, so similarity is controllable. */
function axisVector(axis: number): number[] {
	const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
	vector[axis] = 1;
	return vector;
}

let chunkSeq = 0;

function insertDocument(
	database: Database,
	id: string,
	title: string,
	createdAt: number,
): void {
	database
		.prepare(
			"INSERT INTO documents (id, title, filename, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(id, title, `${id}.txt`, "text/plain", 1, createdAt);
}

function insertChunk(
	database: Database,
	documentId: string,
	ordinal: number,
	content: string,
	embedding: number[],
): string {
	const id = `chunk-${chunkSeq++}`;
	database
		.prepare(
			"INSERT INTO chunks (id, document_id, ordinal, content) VALUES (?, ?, ?, ?)",
		)
		.run(id, documentId, ordinal, content);
	database
		.prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)")
		.run(id, toVectorBlob(embedding));
	return id;
}

describe("buildBrainGraph — chunk level", () => {
	it("builds a sequence backbone and KNN semantic edges", () => {
		db = openDatabase(":memory:");
		// Two documents on the same axis (similar) and one on a different axis.
		insertDocument(db, "doc-a", "Alpha", 1);
		insertChunk(db, "doc-a", 0, "alpha one", axisVector(0));
		insertChunk(db, "doc-a", 1, "alpha two", axisVector(0));
		insertDocument(db, "doc-b", "Beta", 2);
		insertChunk(db, "doc-b", 0, "beta one", axisVector(0));
		insertDocument(db, "doc-c", "Gamma", 3);
		insertChunk(db, "doc-c", 0, "gamma one", axisVector(5));

		const graph = buildBrainGraph({ db });

		expect(graph.level).toBe("chunk");
		expect(graph.documentCount).toBe(3);
		expect(graph.nodes).toHaveLength(4);
		for (const node of graph.nodes) expect(node.size).toBe(1);

		// Sequence edge between doc-a's two consecutive chunks.
		const sequence = graph.links.filter((l) => l.kind === "sequence");
		expect(sequence).toHaveLength(1);

		// Semantic edges only link the axis-0 chunks; the axis-5 chunk is isolated.
		const semantic = graph.links.filter((l) => l.kind === "semantic");
		expect(semantic.length).toBeGreaterThan(0);
		const semanticNodeIds = new Set(
			semantic.flatMap((l) => [l.source, l.target]),
		);
		const gammaNode = graph.nodes.find((n) => n.documentId === "doc-c");
		expect(gammaNode).toBeDefined();
		expect(semanticNodeIds.has(gammaNode?.id ?? "")).toBe(false);
	});

	it("deduplicates edges and caps per-node degree", () => {
		db = openDatabase(":memory:");
		insertDocument(db, "doc", "Dense", 1);
		// Ten near-identical chunks → every pair is similar.
		for (let i = 0; i < 10; i += 1) {
			insertChunk(db, "doc", i, `chunk ${i}`, axisVector(0));
		}

		const maxDegree = 3;
		const graph = buildBrainGraph({ db, maxDegree });

		// No duplicate undirected edges.
		const keys = graph.links.map((l) =>
			l.source < l.target
				? `${l.source}|${l.target}`
				: `${l.target}|${l.source}`,
		);
		expect(new Set(keys).size).toBe(keys.length);

		// Per-node degree never exceeds the cap.
		const degree = new Map<string, number>();
		for (const link of graph.links) {
			degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
			degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
		}
		for (const count of degree.values()) {
			expect(count).toBeLessThanOrEqual(maxDegree);
		}
	});
});

describe("buildBrainGraph — document level", () => {
	it("aggregates chunks into one node per document above the threshold", () => {
		db = openDatabase(":memory:");
		insertDocument(db, "doc-a", "Alpha", 1);
		insertChunk(db, "doc-a", 0, "a1", axisVector(0));
		insertChunk(db, "doc-a", 1, "a2", axisVector(0));
		insertChunk(db, "doc-a", 2, "a3", axisVector(0));
		insertDocument(db, "doc-b", "Beta", 2);
		insertChunk(db, "doc-b", 0, "b1", axisVector(0));
		insertDocument(db, "doc-c", "Gamma", 3);
		insertChunk(db, "doc-c", 0, "c1", axisVector(7));

		// Force the document path with a tiny threshold.
		const graph = buildBrainGraph({ db, chunkLodThreshold: 2 });

		expect(graph.level).toBe("document");
		expect(graph.nodes).toHaveLength(3);
		expect(graph.documentCount).toBe(3);

		const alpha = graph.nodes.find((n) => n.documentId === "doc-a");
		expect(alpha?.size).toBe(3);

		// Largest document first.
		expect(graph.nodes[0]?.documentId).toBe("doc-a");

		// Semantic edge links the two axis-0 documents, not the axis-7 one.
		const semantic = graph.links.filter((l) => l.kind === "semantic");
		expect(semantic).toHaveLength(1);
		expect(graph.links.some((l) => l.kind === "sequence")).toBe(false);
		const linked = new Set(semantic.flatMap((l) => [l.source, l.target]));
		expect(linked.has("doc-c")).toBe(false);
	});
});

describe("buildBrainGraph — cache", () => {
	it("returns the same object on a second call with an unchanged corpus", () => {
		db = openDatabase(":memory:");
		insertDocument(db, "doc", "Doc", 1);
		insertChunk(db, "doc", 0, "one", axisVector(0));
		insertChunk(db, "doc", 1, "two", axisVector(0));

		const first = buildBrainGraph({ db });
		const second = buildBrainGraph({ db });
		expect(second).toBe(first);

		// Adding a chunk changes the signature and invalidates the cache.
		insertChunk(db, "doc", 2, "three", axisVector(0));
		const third = buildBrainGraph({ db });
		expect(third).not.toBe(first);
	});
});
