import { parseOffice, type SupportedFileType } from "officeparser";
import { getEnv } from "@/lib/ai/env";
import { normalizeText } from "./normalize";
import { ocrImage } from "./ocr";
import { ocrPdfImages } from "./pdf-ocr";

export type ExtractResult =
	| { ok: true; text: string }
	| { ok: false; error: string };

/** officeparser-supported types keyed by lowercase file extension. */
const OFFICE_EXTENSIONS: Record<string, SupportedFileType> = {
	docx: "docx",
	pptx: "pptx",
	xlsx: "xlsx",
	odt: "odt",
	odp: "odp",
	ods: "ods",
	pdf: "pdf",
	rtf: "rtf",
	md: "md",
	html: "html",
	htm: "html",
	csv: "csv",
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "tiff", "tif"]);

function extensionOf(filename: string): string {
	const dot = filename.lastIndexOf(".");
	return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function isImage(extension: string, mime: string): boolean {
	return IMAGE_EXTENSIONS.has(extension) || mime.startsWith("image/");
}

/** Append OCR text from extracted image/chart attachments to the document text. */
function withAttachmentOcr(
	baseText: string,
	attachments: { ocrText?: string }[],
): string {
	const ocrTexts = attachments
		.map((attachment) => attachment.ocrText?.trim())
		.filter((value): value is string => Boolean(value));
	if (ocrTexts.length === 0) return baseText;
	return [baseText, ...ocrTexts].join("\n\n").trim();
}

/**
 * Extract plain text from an uploaded document. Dispatches by extension/mime:
 * - plain text (`.txt`, unknown text/*) → decoded directly
 * - office/pdf formats → officeparser (with OCR on embedded images when enabled)
 * - standalone images → Tesseract OCR
 */
export async function extractText(
	data: Buffer,
	filename: string,
	mime: string,
	signal?: AbortSignal,
): Promise<ExtractResult> {
	const env = getEnv();
	const extension = extensionOf(filename);

	if (isImage(extension, mime)) {
		try {
			const text = normalizeText(await ocrImage(data), { aggressive: true });
			return { ok: true, text };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "OCR failed.",
			};
		}
	}

	const fileType = OFFICE_EXTENSIONS[extension];
	if (fileType) {
		try {
			// For PDFs we deliberately disable officeparser's built-in OCR: it feeds
			// uncapped page rasters to Tesseract (slow, and prone to an uncaught
			// "Too many properties to enumerate") and mishandles 1-bpp scans anyway.
			// Scanned PDFs are handled by our own size-capped `ocrPdfImages` path
			// below. Other office formats keep OCR for their small embedded images.
			const useOfficeOcr = env.OCR_ENABLED && fileType !== "pdf";
			const ast = await parseOffice(data, {
				fileType,
				extractAttachments: useOfficeOcr,
				ocr: useOfficeOcr,
				ocrLanguage: env.OCR_LANGUAGE,
				abortSignal: signal ?? null,
			});
			const parsed = withAttachmentOcr(ast.toText().trim(), ast.attachments);

			// A PDF with no text layer is a scan: OCR its rendered page images via
			// our controlled, size-capped path.
			if (parsed.length === 0 && fileType === "pdf" && env.OCR_ENABLED) {
				const ocrText = await ocrPdfImages(data, signal);
				return { ok: true, text: normalizeText(ocrText, { aggressive: true }) };
			}

			return { ok: true, text: normalizeText(parsed) };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "Parsing failed.",
			};
		}
	}

	// Plain text / markdown / anything text-like: decode directly.
	if (
		extension === "txt" ||
		extension === "text" ||
		mime.startsWith("text/") ||
		mime === "application/json"
	) {
		return { ok: true, text: normalizeText(data.toString("utf8")) };
	}

	return {
		ok: false,
		error: `Unsupported file type: ${filename} (${mime || "unknown mime"}).`,
	};
}
