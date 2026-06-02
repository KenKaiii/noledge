import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "@/lib/ai/rag/retrieve";
import { buildSystemPrompt, toSources } from "./prompt";

const chunks: RetrievedChunk[] = [
	{
		chunkId: "c1",
		documentId: "d1",
		documentTitle: "Cat Facts",
		content: "Cats sleep a lot.",
		distance: 0.1,
	},
	{
		chunkId: "c2",
		documentId: "d1",
		documentTitle: "Cat Facts",
		content: "Cats purr when content.",
		distance: 0.2,
	},
];

describe("buildSystemPrompt", () => {
	it("returns the base prompt with no chunks", () => {
		const prompt = buildSystemPrompt([]);
		expect(prompt).not.toContain("<context>");
	});

	it("injects retrieved context and source titles", () => {
		const prompt = buildSystemPrompt(chunks);
		expect(prompt).toContain("<context>");
		expect(prompt).toContain("Cat Facts");
		expect(prompt).toContain("Cats sleep a lot.");
	});
});

describe("toSources", () => {
	it("deduplicates by document id", () => {
		const sources = toSources(chunks);
		expect(sources).toHaveLength(1);
		expect(sources[0]?.title).toBe("Cat Facts");
	});
});
