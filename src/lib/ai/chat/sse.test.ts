import { describe, expect, it } from "vitest";
import { type ChatStreamChunk, encodeChunk } from "./sse";

const decoder = new TextDecoder();

function decode(chunk: ChatStreamChunk): ChatStreamChunk {
	const raw = decoder.decode(encodeChunk(chunk));
	expect(raw.startsWith("data: ")).toBe(true);
	expect(raw.endsWith("\n\n")).toBe(true);
	return JSON.parse(raw.slice(6).trim()) as ChatStreamChunk;
}

describe("encodeChunk", () => {
	it("round-trips every chunk variant", () => {
		const variants: ChatStreamChunk[] = [
			{ type: "reasoning", text: "thinking" },
			{ type: "step", step: { id: "s1", label: "L", detail: "D" } },
			{ type: "text", text: "hello" },
			{
				type: "source",
				source: { id: "1", href: "#1", title: "T", description: "D" },
			},
			{ type: "image", url: "http://x/y.png", alt: "alt" },
			{ type: "done" },
		];

		for (const chunk of variants) {
			expect(decode(chunk)).toEqual(chunk);
		}
	});
});
