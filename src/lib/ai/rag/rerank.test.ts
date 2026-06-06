import type { Database } from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@/lib/ai/db/client";
import { setAppSetting } from "@/lib/ai/settings";
import type { RetrievedChunk } from "./retrieve";

const rerankMock = vi.fn();

vi.mock("ai", () => ({
	rerank: (args: unknown) => rerankMock(args),
}));

vi.mock("@ai-sdk/cohere", () => ({
	createCohere: () => ({
		reranking: (modelId: string) => ({ modelId }),
	}),
}));

import {
	cohereReranker,
	getConfiguredReranker,
	identityReranker,
} from "./rerank";

function chunk(id: string, content: string, score: number): RetrievedChunk {
	return {
		chunkId: id,
		documentId: `doc-${id}`,
		documentTitle: `Doc ${id}`,
		content,
		distance: 0,
		score,
		documentCreatedAt: 0,
		documentDate: 0,
	};
}

let db: Database | null = null;

afterEach(() => {
	db?.close();
	db = null;
	rerankMock.mockReset();
});

describe("cohereReranker", () => {
	it("reorders chunks per the rerank result and copies relevance scores", async () => {
		const chunks = [
			chunk("a", "alpha", 0.9),
			chunk("b", "beta", 0.5),
			chunk("c", "gamma", 0.3),
		];
		rerankMock.mockResolvedValue({
			ranking: [
				{ originalIndex: 2, score: 0.99, document: "gamma" },
				{ originalIndex: 0, score: 0.7, document: "alpha" },
				{ originalIndex: 1, score: 0.2, document: "beta" },
			],
		});

		const reranker = cohereReranker({ apiKey: "key" });
		const out = await reranker("q", chunks);

		expect(out.map((c) => c.chunkId)).toEqual(["c", "a", "b"]);
		expect(out.map((c) => c.score)).toEqual([0.99, 0.7, 0.2]);
	});

	it("returns the input unchanged when the rerank call throws", async () => {
		const chunks = [chunk("a", "alpha", 0.9), chunk("b", "beta", 0.5)];
		rerankMock.mockRejectedValue(new Error("provider down"));

		const reranker = cohereReranker({ apiKey: "key" });
		const out = await reranker("q", chunks);

		expect(out).toBe(chunks);
	});

	it("skips the network for empty input", async () => {
		const reranker = cohereReranker({ apiKey: "key" });
		const out = await reranker("q", []);
		expect(out).toEqual([]);
		expect(rerankMock).not.toHaveBeenCalled();
	});
});

describe("getConfiguredReranker", () => {
	it("returns the identity reranker when disabled", () => {
		db = openDatabase(":memory:");
		expect(getConfiguredReranker(db)).toBe(identityReranker);
	});

	it("returns the identity reranker when enabled but no key", () => {
		db = openDatabase(":memory:");
		setAppSetting("rag.rerankEnabled", "true", db);
		expect(getConfiguredReranker(db)).toBe(identityReranker);
	});

	it("returns a real reranker when enabled with a key", async () => {
		db = openDatabase(":memory:");
		setAppSetting("rag.rerankEnabled", "true", db);
		setAppSetting("rag.rerankApiKey", "secret", db);

		const reranker = getConfiguredReranker(db);
		expect(reranker).not.toBe(identityReranker);

		rerankMock.mockResolvedValue({
			ranking: [{ originalIndex: 0, score: 0.8, document: "alpha" }],
		});
		const out = await reranker("q", [chunk("a", "alpha", 0.1)]);
		expect(out[0]?.score).toBe(0.8);
		expect(rerankMock).toHaveBeenCalledTimes(1);
	});
});
