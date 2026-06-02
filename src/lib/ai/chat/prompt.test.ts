import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "@/lib/ai/rag/retrieve";
import { buildToolSystemPrompt, toSources } from "./prompt";

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

describe("buildToolSystemPrompt", () => {
	it("never injects retrieved context", () => {
		const prompt = buildToolSystemPrompt();
		expect(prompt).not.toContain("<context>");
	});

	it("instructs the model to use the searchKnowledge tool", () => {
		const prompt = buildToolSystemPrompt();
		expect(prompt).toContain("searchKnowledge");
	});
});

describe("toSources", () => {
	it("deduplicates by document id", () => {
		const sources = toSources(chunks);
		expect(sources).toHaveLength(1);
		expect(sources[0]?.title).toBe("Cat Facts");
	});
});
