import { parseOffice, type SupportedFileType } from "officeparser";
import { getEnv } from "@/lib/ai/env";
import { ocrImage } from "./ocr";

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
			const text = await ocrImage(data);
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
			const ast = await parseOffice(data, {
				fileType,
				extractAttachments: env.OCR_ENABLED,
				ocr: env.OCR_ENABLED,
				ocrLanguage: env.OCR_LANGUAGE,
				abortSignal: signal ?? null,
			});
			const text = withAttachmentOcr(ast.toText().trim(), ast.attachments);
			return { ok: true, text };
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
		return { ok: true, text: data.toString("utf8").trim() };
	}

	return {
		ok: false,
		error: `Unsupported file type: ${filename} (${mime || "unknown mime"}).`,
	};
}
