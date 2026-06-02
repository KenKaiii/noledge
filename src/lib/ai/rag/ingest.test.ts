import type { Database } from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/ai/db/client";
import type { Embedder } from "./ingest";
import { ingestDocument } from "./ingest";
import { retrieveChunks } from "./retrieve";

/**
 * Deterministic fake embedder: maps text to a 1536-dim vector keyed on the topic
 * keyword it contains, so semantically grouped docs cluster.
 */
const TOPICS = ["cat", "finance", "weather"];

function fakeEmbed(text: string): number[] {
	const vector: number[] = new Array<number>(1536);
	for (let i = 0; i < vector.length; i++) vector[i] = 0;
	const lower = text.toLowerCase();
	TOPICS.forEach((topic, index) => {
		if (lower.includes(topic)) vector[index] = 1;
	});
	// Fallback so empty matches still produce a valid unit-ish vector.
	let allZero = true;
	for (const value of vector) {
		if (value !== 0) {
			allZero = false;
			break;
		}
	}
	if (allZero) vector[1535] = 1;
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

describe("ingest + retrieve", () => {
	it("ranks the semantically matching chunk first and round-trips metadata", async () => {
		db = openDatabase(":memory:");

		const docs = [
			{ title: "Cats", text: "The cat sat on the warm windowsill purring." },
			{
				title: "Finance",
				text: "Quarterly finance report shows strong revenue.",
			},
			{
				title: "Weather",
				text: "The weather forecast predicts heavy rain today.",
			},
		];

		for (const doc of docs) {
			const result = await ingestDocument(
				{
					data: Buffer.from(doc.text, "utf8"),
					filename: `${doc.title}.txt`,
					mime: "text/plain",
					title: doc.title,
				},
				{ db, embedder, chunkOptions: { size: 1000, overlap: 0 } },
			);
			expect(result.ok).toBe(true);
		}

		const retrieved = await retrieveChunks("Tell me about the cat", {
			db,
			embedder,
			topK: 1,
		});

		expect(retrieved.ok).toBe(true);
		if (!retrieved.ok) return;
		expect(retrieved.chunks).toHaveLength(1);
		expect(retrieved.chunks[0]?.documentTitle).toBe("Cats");
		expect(retrieved.chunks[0]?.content.toLowerCase()).toContain("cat");
	});

	it("rejects a document with no extractable text", async () => {
		db = openDatabase(":memory:");
		const result = await ingestDocument(
			{
				data: Buffer.from("   ", "utf8"),
				filename: "empty.txt",
				mime: "text/plain",
			},
			{ db, embedder },
		);
		expect(result.ok).toBe(false);
	});
});
