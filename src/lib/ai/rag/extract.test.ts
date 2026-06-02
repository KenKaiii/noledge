import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractText } from "./extract";

const FIXTURES = join(__dirname, "__fixtures__");

function fixture(name: string): Buffer {
	return readFileSync(join(FIXTURES, name));
}

describe("extractText", () => {
	it("reads plain text directly", async () => {
		const result = await extractText(
			fixture("sample.txt"),
			"sample.txt",
			"text/plain",
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text).toContain("quick brown fox");
	});

	it("reads markdown", async () => {
		const result = await extractText(
			fixture("sample.md"),
			"sample.md",
			"text/markdown",
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text.toLowerCase()).toContain("markdown");
	});

	it("extracts text from a PDF", async () => {
		const result = await extractText(
			fixture("sample.pdf"),
			"sample.pdf",
			"application/pdf",
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text).toContain("Hello world from a PDF");
	});

	it("rejects unsupported types", async () => {
		const result = await extractText(
			Buffer.from([0, 1, 2, 3]),
			"data.bin",
			"application/octet-stream",
		);
		expect(result.ok).toBe(false);
	});

	it("OCRs a standalone image", async () => {
		const result = await extractText(
			fixture("hello.png"),
			"hello.png",
			"image/png",
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text.toLowerCase()).toContain("hello");
	}, 120_000);
});
