import { cosineSimilarity } from "ai";
import { describe, expect, it } from "vitest";
import { embedTexts } from "./embed";

const hasKey = Boolean(process.env.OPENAI_API_KEY);

describe.skipIf(!hasKey)("embedTexts (network)", () => {
	it("returns 1536-dim vectors and ranks similar texts closer", async () => {
		const result = await embedTexts([
			"The cat sat on the warm windowsill.",
			"A feline rested by the sunny window.",
			"Quarterly revenue increased due to strong sales.",
		]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const [a, b, c] = result.embeddings;
		expect(a).toBeDefined();
		expect(a?.length).toBe(1536);
		if (!a || !b || !c) return;

		const similar = cosineSimilarity(a, b);
		const dissimilar = cosineSimilarity(a, c);
		expect(similar).toBeGreaterThan(dissimilar);
	});
});

describe("embedTexts (no values)", () => {
	it("returns an empty result without calling the network", async () => {
		const result = await embedTexts([]);
		expect(result).toEqual({ ok: true, embeddings: [] });
	});
});
