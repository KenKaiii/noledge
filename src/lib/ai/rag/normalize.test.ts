import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize";

describe("normalizeText", () => {
	it("normalizes CRLF and lone CR to LF", () => {
		expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc");
	});

	it("rejoins words hyphenated across a line break", () => {
		expect(normalizeText("inter-\nnational law")).toBe("international law");
	});

	it("strips trailing whitespace but keeps internal spacing (light)", () => {
		expect(normalizeText("code    block   \n  next")).toBe(
			"code    block\n  next",
		);
	});

	it("collapses 3+ blank lines to a single blank line", () => {
		expect(normalizeText("a\n\n\n\nb")).toBe("a\n\nb");
	});

	it("collapses internal whitespace runs when aggressive", () => {
		expect(normalizeText("the   quick    fox", { aggressive: true })).toBe(
			"the quick fox",
		);
	});

	it("drops OCR salad lines when aggressive", () => {
		const ocr =
			': : * had - . N .". ns ) -\nThe malignant tumor tissue\n. _ a K .';
		expect(normalizeText(ocr, { aggressive: true })).toBe(
			"The malignant tumor tissue",
		);
	});

	it("keeps numeric lines when aggressive", () => {
		expect(normalizeText("1948\nBibliography", { aggressive: true })).toBe(
			"1948\nBibliography",
		);
	});

	it("does not drop salad lines in light mode", () => {
		const text = ": : * x -\nReal content here";
		expect(normalizeText(text)).toContain(": : * x -");
	});
});
