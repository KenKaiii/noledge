import type { Database } from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/ai/db/client";
import type { Embedder } from "./ingest";
import { ingestDocument } from "./ingest";
import type { Reranker } from "./rerank";
import { retrieveChunks } from "./retrieve";

/**
 * Deterministic fake embedder: every doc shares the same query topic so all
 * candidates survive the score filter, letting the reranker decide ordering.
 */
function fakeEmbed(text: string): number[] {
	const vector = new Array<number>(1536).fill(0);
	// Encode a per-doc identity in a low dimension plus a shared "topic" signal
	// so candidates are similar enough to all pass minScore.
	vector[0] = 1;
	const match = text.match(/passage(\d+)/);
	if (match) vector[Number(match[1]) + 1] = 0.01;
	return vector;
}

const embedder: Embedder = async (values) => ({
	ok: true,
	embeddings: values.map(fakeEmbed),
});

let db: Database | null = null;

afterEach(() => {
	db?.close();
	db = null;
});

async function seedPassages(count: number): Promise<void> {
	db = openDatabase(":memory:");
	for (let i = 0; i < count; i++) {
		await ingestDocument(
			{
				data: Buffer.from(`topic passage${i} content body`, "utf8"),
				filename: `passage${i}.txt`,
				mime: "text/plain",
				title: `Passage ${i}`,
			},
			{ db, embedder, chunkOptions: { size: 1000, overlap: 0 } },
		);
	}
}

describe("retrieveChunks reranking", () => {
	it("promotes a passage outside the naive top-k via pool-level reranking", async () => {
		await seedPassages(10);

		// Reranker that ranks the highest passage number first regardless of the
		// fused score, with a relevance score derived from that number.
		const reranker: Reranker = async (_query, chunks) =>
			[...chunks]
				.map((c) => {
					const n = Number(c.documentTitle.replace("Passage ", ""));
					return { ...c, score: n / 100 };
				})
				.sort((a, b) => b.score - a.score);

		const result = await retrieveChunks("topic", {
			db: db as Database,
			embedder,
			topK: 3,
			mmr: false,
			minScore: 0,
			reranker,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// Passage 9 should now lead even though the naive fused order would not
		// necessarily surface it first — proving the larger pool was reranked.
		expect(result.chunks[0]?.documentTitle).toBe("Passage 9");
		expect(result.chunks).toHaveLength(3);
	});

	it("returns identical results on the default identity path", async () => {
		await seedPassages(6);

		const withDefault = await retrieveChunks("topic", {
			db: db as Database,
			embedder,
			topK: 3,
			minScore: 0,
		});
		const withIdentity = await retrieveChunks("topic", {
			db: db as Database,
			embedder,
			topK: 3,
			minScore: 0,
			reranker: async (_q, chunks) => chunks,
		});

		expect(withDefault.ok && withIdentity.ok).toBe(true);
		if (!withDefault.ok || !withIdentity.ok) return;
		// The injected pass-through reranker is not the identity singleton, so it
		// exercises the pool path; with a pass-through it must still land on the
		// same set of chunks as the default path.
		expect(withDefault.chunks.map((c) => c.chunkId).sort()).toEqual(
			withIdentity.chunks.map((c) => c.chunkId).sort(),
		);
	});
});
