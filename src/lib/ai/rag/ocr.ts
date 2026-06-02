import { createWorker } from "tesseract.js";
import { getEnv } from "@/lib/ai/env";

/**
 * Standalone-image OCR via Tesseract.js. Office/PDF documents use officeparser's
 * integrated, pooled OCR (see `extract.ts`); this path handles raw image uploads
 * (.png/.jpg/.webp/.tiff). Pure JS — no native binaries.
 */
export async function ocrImage(data: Buffer): Promise<string> {
	const env = getEnv();
	if (!env.OCR_ENABLED) return "";

	const worker = await createWorker(env.OCR_LANGUAGE);
	try {
		const { data: result } = await worker.recognize(data);
		return result.text.trim();
	} finally {
		await worker.terminate();
	}
}
