export type ChunkOptions = {
	/** Target chunk size in characters. */
	size?: number;
	/** Overlap between consecutive chunks in characters. */
	overlap?: number;
};

const DEFAULT_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

/**
 * Split text into overlapping fixed-size chunks. Deterministic and ordered: the
 * same input always yields the same chunk list. Whitespace-only input yields no
 * chunks. Overlap is clamped to `size - 1` to guarantee forward progress.
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

	const step = size - overlap;
	const chunks: string[] = [];
	for (let start = 0; start < normalized.length; start += step) {
		const slice = normalized.slice(start, start + size).trim();
		if (slice.length > 0) chunks.push(slice);
		if (start + size >= normalized.length) break;
	}
	return chunks;
}
