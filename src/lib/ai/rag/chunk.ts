export type ChunkOptions = {
	/** Target chunk size in characters. */
	size?: number;
	/** Overlap between consecutive chunks in characters. */
	overlap?: number;
};

const DEFAULT_SIZE = 1000;
const DEFAULT_OVERLAP = 200;

/**
 * Boundary separators tried in order of preference: keep paragraphs whole, then
 * sentences/lines, then words, and only split mid-word (`""`) as a last resort.
 * This is the recursive-character strategy used by LangChain et al.
 */
const SEPARATORS = ["\n\n", "\n", " ", ""] as const;

/** Split `text` on `separator`; `""` means split into individual characters. */
function splitOn(text: string, separator: string): string[] {
	if (separator === "") return Array.from(text);
	return text.split(separator).filter((part) => part.length > 0);
}

/** Join pieces back with their separator, returning null for empty results. */
function joinPieces(pieces: string[], separator: string): string | null {
	const text = pieces.join(separator).trim();
	return text.length === 0 ? null : text;
}

/**
 * Greedily pack already-small pieces into chunks near `size`, carrying `overlap`
 * characters from the tail of each emitted chunk into the next. Mirrors
 * LangChain's `_merge_splits` so windows advance deterministically.
 */
function mergePieces(
	pieces: string[],
	separator: string,
	size: number,
	overlap: number,
): string[] {
	const sepLen = separator.length;
	const chunks: string[] = [];
	const current: string[] = [];
	let total = 0;

	for (const piece of pieces) {
		const len = piece.length;
		const withSep = total + len + (current.length > 0 ? sepLen : 0);
		if (withSep > size && current.length > 0) {
			const chunk = joinPieces(current, separator);
			if (chunk !== null) chunks.push(chunk);
			// Shrink the window from the front until the carried overlap fits.
			while (
				total > overlap ||
				(total + len + (current.length > 0 ? sepLen : 0) > size && total > 0)
			) {
				total -= (current[0]?.length ?? 0) + (current.length > 1 ? sepLen : 0);
				current.shift();
			}
		}
		current.push(piece);
		total += len + (current.length > 1 ? sepLen : 0);
	}

	const last = joinPieces(current, separator);
	if (last !== null) chunks.push(last);
	return chunks;
}

/** Recursively split `text`, descending the separator list for oversized parts. */
function splitRecursive(
	text: string,
	separators: readonly string[],
	size: number,
	overlap: number,
): string[] {
	// Pick the first separator present in the text; fall back to char-level.
	let separator = separators[separators.length - 1] ?? "";
	let rest: readonly string[] = [];
	for (let i = 0; i < separators.length; i += 1) {
		const candidate = separators[i] ?? "";
		if (candidate === "") {
			separator = candidate;
			break;
		}
		if (text.includes(candidate)) {
			separator = candidate;
			rest = separators.slice(i + 1);
			break;
		}
	}

	const chunks: string[] = [];
	const goodPieces: string[] = [];

	for (const piece of splitOn(text, separator)) {
		if (piece.length < size) {
			goodPieces.push(piece);
			continue;
		}
		// Flush accumulated small pieces before handling the oversized one.
		if (goodPieces.length > 0) {
			chunks.push(...mergePieces(goodPieces, separator, size, overlap));
			goodPieces.length = 0;
		}
		if (rest.length === 0) {
			chunks.push(piece);
		} else {
			chunks.push(...splitRecursive(piece, rest, size, overlap));
		}
	}

	if (goodPieces.length > 0) {
		chunks.push(...mergePieces(goodPieces, separator, size, overlap));
	}
	return chunks;
}

/**
 * Split text into overlapping chunks along natural boundaries (paragraphs →
 * lines → words → characters), keeping each under `size`. Deterministic and
 * ordered: the same input always yields the same chunk list. Whitespace-only
 * input yields no chunks. Overlap is clamped to `size - 1` to guarantee forward
 * progress.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
	const size = Math.max(1, options.size ?? DEFAULT_SIZE);
	const overlap = Math.min(
		Math.max(0, options.overlap ?? DEFAULT_OVERLAP),
		size - 1,
	);

	const normalized = text.replace(/\r\n/g, "\n").trim();
	if (normalized.length === 0) return [];
	if (normalized.length <= size) return [normalized];

	return splitRecursive(normalized, SEPARATORS, size, overlap);
}
