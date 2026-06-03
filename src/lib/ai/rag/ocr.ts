import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { getEnv } from "@/lib/ai/env";

/**
 * OCR utilities built on Tesseract.js (pure JS — no native binaries).
 *
 * Tesseract chokes on large or noisy rasters: a high-DPI or speckled scan
 * produces a huge number of candidate components, which makes recognition very
 * slow and can trip a worker-side V8 limit that surfaces as an uncaught
 * `RangeError: Too many properties to enumerate`. To stay fast and stable we
 * always downscale + flatten images before recognition and cap each call with a
 * timeout.
 */

/** Cap the longest edge handed to Tesseract; plenty of resolution for text. */
export const MAX_OCR_EDGE = 2000;

/** Hard ceiling on a single `recognize()` call so a pathological image can't hang. */
export const OCR_TIMEOUT_MS = 60_000;

/**
 * Preprocess an encoded image for OCR: downscale oversized scans, flatten to
 * grayscale, and normalize contrast. Returns a PNG buffer.
 */
export async function prepareForOcr(data: Buffer): Promise<Buffer> {
	return sharp(data)
		.resize({
			width: MAX_OCR_EDGE,
			height: MAX_OCR_EDGE,
			fit: "inside",
			withoutEnlargement: true,
		})
		.grayscale()
		.normalize()
		.png()
		.toBuffer();
}

/** Reject if `promise` does not settle within `ms`. */
export async function withOcrTimeout<T>(
	promise: Promise<T>,
	ms: number = OCR_TIMEOUT_MS,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`OCR timed out after ${ms}ms`)),
			ms,
		);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Standalone-image OCR via Tesseract.js for raw image uploads
 * (.png/.jpg/.webp/.tiff). Office/PDF documents use the dedicated paths in
 * `extract.ts` / `pdf-ocr.ts`.
 */
export async function ocrImage(data: Buffer): Promise<string> {
	const env = getEnv();
	if (!env.OCR_ENABLED) return "";

	const prepared = await prepareForOcr(data);
	const worker = await createWorker(env.OCR_LANGUAGE);
	try {
		const { data: result } = await withOcrTimeout(worker.recognize(prepared));
		return result.text.trim();
	} finally {
		await worker.terminate();
	}
}
