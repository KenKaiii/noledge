export type NormalizeOptions = {
	/**
	 * Apply OCR-grade cleanup: collapse intra-line whitespace runs and drop
	 * "salad" lines that carry no real word. Use for text from image/scanned
	 * sources; leave off for already-clean text (plain text, office docs) so
	 * structure such as code indentation survives.
	 */
	aggressive?: boolean;
};

/** Length of the longest run of consecutive letters in a string. */
function longestLetterRun(line: string): number {
	let longest = 0;
	let current = 0;
	for (const char of line) {
		if (/\p{L}/u.test(char)) {
			current += 1;
			if (current > longest) longest = current;
		} else {
			current = 0;
		}
	}
	return longest;
}

/** A line made up only of digits and numeric punctuation (page numbers, tables). */
function isNumericLine(line: string): boolean {
	return /^[\d][\d.,:%\s/-]*$/.test(line);
}

/**
 * A line is OCR "salad" when it carries no real word (no run of ≥4 letters) and
 * is not a legitimate numeric line — e.g. `: : * had - . N ."`. Keeping the bar
 * at a 4-letter run preserves any prose line (which always contains a real word)
 * while discarding symbol/letter-fragment noise from bad scans.
 */
function isNoiseLine(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) return false; // blank lines handled elsewhere
	if (isNumericLine(trimmed)) return false;
	return longestLetterRun(trimmed) < 4;
}

/**
 * Clean extracted document text before chunking/embedding.
 *
 * Always-on (safe for every source):
 *  - normalize CRLF / lone CR to `\n`
 *  - rejoin words hyphenated across a line break (`inter-\nnational` → `international`)
 *  - strip trailing whitespace per line
 *  - collapse 3+ blank lines down to a single blank line
 *
 * Aggressive (OCR/scanned sources only):
 *  - collapse runs of spaces/tabs to a single space
 *  - drop salad lines with no real word
 */
export function normalizeText(
	text: string,
	options: NormalizeOptions = {},
): string {
	let out = text.replace(/\r\n?/g, "\n");

	// Rejoin words split by a hyphen at end of line.
	out = out.replace(/(\p{L})-\n(\p{L})/gu, "$1$2");

	if (options.aggressive) {
		// Collapse horizontal whitespace runs within lines.
		out = out
			.split("\n")
			.map((line) => line.replace(/[ \t]+/g, " ").trim())
			.filter((line) => !isNoiseLine(line))
			.join("\n");
	} else {
		// Light touch: only trim trailing whitespace, keep internal spacing.
		out = out
			.split("\n")
			.map((line) => line.replace(/[ \t]+$/g, ""))
			.join("\n");
	}

	// Collapse excessive blank lines (3+ newlines → one blank line).
	out = out.replace(/\n{3,}/g, "\n\n");

	return out.trim();
}
