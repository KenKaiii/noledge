import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
	it("returns no chunks for whitespace-only input", () => {
		expect(chunkText("   \n\t  ")).toEqual([]);
	});

	it("returns a single chunk when text fits", () => {
		expect(chunkText("short text", { size: 100 })).toEqual(["short text"]);
	});

	it("produces deterministic overlapping chunks", () => {
		const text = "abcdefghijklmnopqrstuvwxyz";
		const chunks = chunkText(text, { size: 10, overlap: 4 });

		// step = 6 → starts at 0, 6, 12, 18 (last slice reaches the end, loop stops)
		expect(chunks).toEqual([
			"abcdefghij",
			"ghijklmnop",
			"mnopqrstuv",
			"stuvwxyz",
		]);
		// stable on repeat
		expect(chunkText(text, { size: 10, overlap: 4 })).toEqual(chunks);
	});

	it("clamps overlap below size to guarantee progress", () => {
		const chunks = chunkText("abcdefghij", { size: 4, overlap: 10 });
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((c) => c.length <= 4)).toBe(true);
	});
});
