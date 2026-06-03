import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { getEnv } from "@/lib/ai/env";
import { MAX_OCR_EDGE, withOcrTimeout } from "./ocr";

/**
 * Fallback OCR for scanned PDFs.
 *
 * officeparser extracts a PDF's embedded images and OCRs them, but it mishandles
 * packed 1-bit-per-pixel images (the format most black-and-white document
 * scanners produce): it reads the bit-packed buffer as one byte per pixel, so
 * the image is garbled and OCR yields nothing. We re-extract each page's images
 * straight from pdf.js — which already decoded the source encoding (CCITT,
 * JBIG2, JPEG, 1-bpp grayscale, …) — convert them to a clean raster with sharp,
 * and OCR with Tesseract.
 *
 * Only invoked when officeparser returns no text for a PDF and OCR is enabled.
 */

const require = createRequire(import.meta.url);

type PdfImage = {
	width: number;
	height: number;
	kind: number;
	data: Uint8Array | Uint8ClampedArray;
};

type RawImage = {
	buffer: Buffer;
	width: number;
	height: number;
	channels: 1 | 3 | 4;
};

// pdf.js ImageKind values.
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

// Skip decorative artifacts and sub-glyph fragments.
const MIN_DIMENSION = 16;

/** Convert a pdf.js image object into a sharp-compatible raw raster. */
function toRawImage(image: PdfImage): RawImage | null {
	const { width, height, kind, data } = image;
	if (width <= 0 || height <= 0 || data.length === 0) return null;
	const pixels = width * height;

	if (kind === RGBA_32BPP || data.length === pixels * 4) {
		return { buffer: Buffer.from(data), width, height, channels: 4 };
	}
	if (kind === RGB_24BPP || data.length === pixels * 3) {
		return { buffer: Buffer.from(data), width, height, channels: 3 };
	}
	if (data.length === pixels) {
		// 8-bit grayscale, one byte per pixel.
		return { buffer: Buffer.from(data), width, height, channels: 1 };
	}
	if (kind === GRAYSCALE_1BPP) {
		// Packed 1 bit per pixel, rows aligned to byte boundaries.
		const rowBytes = Math.ceil(width / 8);
		if (rowBytes * height > data.length) return null;
		const gray = Buffer.alloc(pixels);
		for (let y = 0; y < height; y++) {
			const rowStart = y * rowBytes;
			for (let x = 0; x < width; x++) {
				const byte = data[rowStart + (x >> 3)] ?? 0;
				const bit = (byte >> (7 - (x & 7))) & 1;
				gray[y * width + x] = bit ? 255 : 0;
			}
		}
		return { buffer: gray, width, height, channels: 1 };
	}
	return null;
}

/**
 * Resolve a pdf.js image object by name. pdf.js exposes a callback-based `get`
 * that fires once the object is registered (which can lag `has()` returning
 * true), so we resolve via callback with a timeout guard rather than gating on
 * `has()`.
 */
function resolveObject(
	// biome-ignore lint/suspicious/noExplicitAny: pdf.js object store has no exported type.
	store: any,
	name: string,
): Promise<PdfImage | null> {
	return new Promise<PdfImage | null>((resolve) => {
		let settled = false;
		const done = (value: PdfImage | null): void => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const timer = setTimeout(() => done(null), 5000);
		try {
			store.get(name, (value: PdfImage | null) => {
				clearTimeout(timer);
				done(value);
			});
		} catch {
			clearTimeout(timer);
			done(null);
		}
	});
}

/** Collect every renderable image on a single pdf.js page. */
async function collectPageImages(
	// biome-ignore lint/suspicious/noExplicitAny: pdf.js page has no exported type here.
	page: any,
	// biome-ignore lint/suspicious/noExplicitAny: pdf.js OPS enum.
	ops: any,
): Promise<PdfImage[]> {
	const operatorList = await page.getOperatorList();
	const images: PdfImage[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < operatorList.fnArray.length; i++) {
		const fn = operatorList.fnArray[i];
		if (fn !== ops.paintImageXObject && fn !== ops.paintXObject) continue;
		const name = operatorList.argsArray[i][0];
		if (typeof name !== "string" || seen.has(name)) continue;
		seen.add(name);
		const obj =
			(await resolveObject(page.objs, name)) ??
			(await resolveObject(page.commonObjs, name));
		if (
			obj?.data &&
			obj.width >= MIN_DIMENSION &&
			obj.height >= MIN_DIMENSION
		) {
			images.push(obj);
		}
	}
	return images;
}

/**
 * Extract text from a scanned PDF by OCR-ing each page's embedded images.
 * Returns the concatenated OCR text (possibly empty). Throws on hard failures.
 */
export async function ocrPdfImages(
	data: Buffer,
	signal?: AbortSignal,
): Promise<string> {
	const env = getEnv();
	if (!env.OCR_ENABLED) return "";

	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	try {
		pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
			require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
		).href;
	} catch {
		// Fall back to pdf.js's default worker resolution.
	}

	const document = await pdfjs.getDocument({
		data: new Uint8Array(data),
		verbosity: 0,
	}).promise;

	const worker = await createWorker(env.OCR_LANGUAGE);
	const texts: string[] = [];
	try {
		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
			if (signal?.aborted) throw new Error("Aborted");
			const page = await document.getPage(pageNumber);
			const images = await collectPageImages(page, pdfjs.OPS);
			for (const image of images) {
				const raw = toRawImage(image);
				if (!raw) continue;
				// Downscale + flatten before OCR: large/complex page rasters make
				// Tesseract slow and can trip its worker enumeration limit.
				const png = await sharp(raw.buffer, {
					raw: {
						width: raw.width,
						height: raw.height,
						channels: raw.channels,
					},
				})
					.resize({
						width: MAX_OCR_EDGE,
						height: MAX_OCR_EDGE,
						fit: "inside",
						withoutEnlargement: true,
					})
					.grayscale()
					.png()
					.toBuffer();
				const { data: result } = await withOcrTimeout(worker.recognize(png));
				const text = result.text.trim();
				if (text) texts.push(text);
			}
			page.cleanup();
		}
	} finally {
		await worker.terminate();
		await document.destroy();
	}

	return texts.join("\n\n").trim();
}
