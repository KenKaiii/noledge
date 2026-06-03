import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_OCR_EDGE, prepareForOcr, withOcrTimeout } from "./ocr";

describe("withOcrTimeout", () => {
	it("resolves when the promise settles in time", async () => {
		await expect(withOcrTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
	});

	it("rejects when the promise exceeds the timeout", async () => {
		const slow = new Promise((resolve) => setTimeout(resolve, 50));
		await expect(withOcrTimeout(slow, 10)).rejects.toThrow(/timed out/);
	});
});

describe("prepareForOcr", () => {
	it("downscales an oversized image to the edge cap", async () => {
		const big = await sharp({
			create: {
				width: 5000,
				height: 4000,
				channels: 3,
				background: { r: 255, g: 255, b: 255 },
			},
		})
			.png()
			.toBuffer();

		const out = await prepareForOcr(big);
		const meta = await sharp(out).metadata();
		expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
			MAX_OCR_EDGE,
		);
		// Aspect ratio preserved during the downscale.
		expect(meta.width).toBe(MAX_OCR_EDGE);
		expect(meta.height).toBe(1600);
	});

	it("does not enlarge a small image", async () => {
		const small = await sharp({
			create: {
				width: 100,
				height: 80,
				channels: 3,
				background: { r: 0, g: 0, b: 0 },
			},
		})
			.png()
			.toBuffer();

		const meta = await sharp(await prepareForOcr(small)).metadata();
		expect(meta.width).toBe(100);
		expect(meta.height).toBe(80);
	});
});
