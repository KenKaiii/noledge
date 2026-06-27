import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { safeFetch } from "@/lib/ai/net/ssrf";
import { normalizeText } from "@/lib/ai/rag/normalize";
import { type Attempt, isTransientStatus, withRetry } from "../retry";
import { decodeBody } from "./decode";

/**
 * Full-article fetcher for RSS/Atom items whose feed body is only a teaser or
 * summary. Many feeds ship just an excerpt (or, like Next.js blogs, nothing but
 * a one-line blurb), which would embed into a single near-empty chunk. Here we
 * fetch the canonical article URL and run Mozilla Readability over it to pull
 * the main prose — stripping nav, sidebars, footers, comments, and other
 * boilerplate — so the poller can index the real content.
 */

export type ArticleResult =
	| { ok: true; text: string }
	| { ok: false; error: string };

const FETCH_TIMEOUT_MS = 20_000;
// Headroom over the feed cap: some blogs (e.g. Next.js sites) inline large RSC
// payloads, pushing a single article page past 8MB of raw HTML.
const MAX_HTML_BYTES = 16 * 1024 * 1024;

/**
 * Extract the main article text from an HTML string. Returns a `Result`; an
 * unparseable page or one with no discernible article body is a failure rather
 * than an empty success, so callers keep the original feed content.
 */
export function extractArticleText(html: string): ArticleResult {
	try {
		const { document } = parseHTML(html);
		// Readability mutates the document; we parse a fresh one per call so no
		// clone is needed.
		const article = new Readability(document).parse();
		const text = normalizeText(article?.textContent ?? "");
		if (text.length === 0) {
			return { ok: false, error: "No article content found." };
		}
		return { ok: true, text };
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error ? error.message : "Article extraction failed.",
		};
	}
}

function looksLikeHtml(contentType: string | null, body: string): boolean {
	if (contentType && /html|xml/i.test(contentType)) return true;
	if (contentType && !/html|xml|text\/plain/i.test(contentType)) return false;
	// No/ambiguous content-type: sniff the body.
	return /<html[\s>]|<!doctype html|<article[\s>]|<body[\s>]/i.test(
		body.slice(0, 2000),
	);
}

/**
 * Fetch an article URL and extract its main text. The `fetchFn` is injectable so
 * tests can supply article HTML without hitting the network. Network, timeout,
 * size, and content-type failures all return a `Result` so the poller can fall
 * back to the feed-provided body.
 */
export async function fetchArticleText(
	url: string,
	options: { fetchFn?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ArticleResult> {
	if (!/^https?:\/\//i.test(url)) {
		return { ok: false, error: "Article URL is not http(s)." };
	}
	return withRetry(() => fetchArticleTextOnce(url, options), {
		signal: options.signal,
	});
}

async function fetchArticleTextOnce(
	url: string,
	options: { fetchFn?: typeof fetch; signal?: AbortSignal },
): Promise<Attempt<ArticleResult>> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	if (options.signal) {
		options.signal.addEventListener("abort", () => controller.abort(), {
			once: true,
		});
	}
	try {
		const response = await safeFetch(url, {
			headers: {
				Accept: "text/html, application/xhtml+xml, */*; q=0.8",
				"User-Agent": "noledge-automation/1.0 (+feed-poller)",
			},
			signal: controller.signal,
			...(options.fetchFn ? { fetchImpl: options.fetchFn } : {}),
		});
		if (!response.ok) {
			return {
				value: { ok: false, error: `Article returned ${response.status}.` },
				retry: isTransientStatus(response.status),
			};
		}
		const declared = response.headers.get("content-length");
		if (declared && Number(declared) > MAX_HTML_BYTES) {
			return {
				value: { ok: false, error: "Article exceeds the size limit." },
				retry: false,
			};
		}
		const decoded = await decodeBody(response, MAX_HTML_BYTES);
		if (!decoded.ok) {
			return {
				value: { ok: false, error: `Article ${decoded.error.toLowerCase()}` },
				retry: false,
			};
		}
		const html = decoded.text;
		if (!looksLikeHtml(response.headers.get("content-type"), html)) {
			return {
				value: { ok: false, error: "Article URL did not return HTML." },
				retry: false,
			};
		}
		// Extraction outcome is deterministic for the same HTML — never retry it.
		return { value: extractArticleText(html), retry: false };
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			if (options.signal?.aborted) {
				return {
					value: { ok: false, error: "Article fetch aborted." },
					retry: false,
				};
			}
			return {
				value: { ok: false, error: "Article fetch timed out." },
				retry: true,
			};
		}
		return {
			value: {
				ok: false,
				error:
					error instanceof Error ? error.message : "Failed to fetch article.",
			},
			retry: true,
		};
	} finally {
		clearTimeout(timer);
	}
}
