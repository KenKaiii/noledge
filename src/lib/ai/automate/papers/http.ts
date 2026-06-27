/**
 * Shared HTTP helper for the academic-paper providers. Sends a descriptive
 * User-Agent (arXiv/OpenAlex ask for one), follows redirects (arXiv 301s
 * http→https), and enforces an abort/timeout linked to an optional caller
 * `signal` so a slow upstream never stalls a poll. Lives in its own module to
 * keep `papers/index.ts` free of a provider↔index import cycle.
 */

import { safeFetch } from "@/lib/ai/net/ssrf";
import { type Attempt, isTransientStatus, withRetry } from "../retry";

const USER_AGENT = "noledge-automation/1.0 (+paper-poller)";
const FETCH_TIMEOUT_MS = 20_000;

/** Internal sentinel: the caller's signal cancelled the request — never retry. */
const CALLER_ABORTED = "Request aborted.";

export type HttpTextResult =
	| { ok: true; status: number; body: string }
	| { ok: false; error: string };

export type HttpBinaryResult =
	| { ok: true; status: number; body: Buffer; mime: string }
	| { ok: false; error: string };

const MAX_BINARY_BYTES = 40 * 1024 * 1024;
/** Longest server-requested retry wait we will honor. */
const MAX_RETRY_AFTER_MS = 30_000;

/** Whether an HTTP result is worth another attempt. */
function retryHttp<
	T extends { ok: true; status: number } | { ok: false; error: string },
>(result: T, response?: Response): Attempt<T> {
	const retry = result.ok
		? isTransientStatus(result.status)
		: result.error !== CALLER_ABORTED;
	// On a 429, honor the server's Retry-After (seconds form), capped.
	if (retry && response?.status === 429) {
		const header = response.headers.get("retry-after");
		const seconds = header === null ? Number.NaN : Number(header);
		if (Number.isFinite(seconds) && seconds > 0) {
			return {
				value: result,
				retry,
				retryAfterMs: Math.min(seconds * 1000, MAX_RETRY_AFTER_MS),
			};
		}
	}
	return { value: result, retry };
}

/** Fetch a URL as text. Network/timeout failures return a `Result`. */
export async function httpText(
	url: string,
	options: { accept?: string; signal?: AbortSignal } = {},
): Promise<HttpTextResult> {
	return withRetry(() => httpTextOnce(url, options), {
		signal: options.signal,
	});
}

async function httpTextOnce(
	url: string,
	options: { accept?: string; signal?: AbortSignal },
): Promise<Attempt<HttpTextResult>> {
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
				Accept: options.accept ?? "application/json, text/xml, */*; q=0.8",
				"User-Agent": USER_AGENT,
			},
			signal: controller.signal,
		});
		const body = await response.text();
		return retryHttp({ ok: true, status: response.status, body }, response);
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			// Distinguish a caller cancellation (don't retry) from our own timeout.
			if (options.signal?.aborted) {
				return retryHttp({ ok: false, error: CALLER_ABORTED });
			}
			return retryHttp({ ok: false, error: "Request timed out." });
		}
		return retryHttp({
			ok: false,
			error: error instanceof Error ? error.message : "Request failed.",
		});
	} finally {
		clearTimeout(timer);
	}
}

/** Fetch a URL as bytes with a size cap. Network/timeout failures return a `Result`. */
export async function httpBinary(
	url: string,
	options: { accept?: string; signal?: AbortSignal } = {},
): Promise<HttpBinaryResult> {
	return withRetry(() => httpBinaryOnce(url, options), {
		signal: options.signal,
	});
}

async function httpBinaryOnce(
	url: string,
	options: { accept?: string; signal?: AbortSignal },
): Promise<Attempt<HttpBinaryResult>> {
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
				Accept: options.accept ?? "application/pdf, application/octet-stream",
				"User-Agent": USER_AGENT,
			},
			signal: controller.signal,
		});
		const length = response.headers.get("content-length");
		if (length && Number(length) > MAX_BINARY_BYTES) {
			return {
				value: { ok: false, error: "File exceeds the size limit." },
				retry: false,
			};
		}
		const body = Buffer.from(await response.arrayBuffer());
		if (body.byteLength > MAX_BINARY_BYTES) {
			return {
				value: { ok: false, error: "File exceeds the size limit." },
				retry: false,
			};
		}
		return retryHttp(
			{
				ok: true,
				status: response.status,
				body,
				mime:
					response.headers.get("content-type") ?? "application/octet-stream",
			},
			response,
		);
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			if (options.signal?.aborted) {
				return retryHttp({ ok: false, error: CALLER_ABORTED });
			}
			return retryHttp({ ok: false, error: "Request timed out." });
		}
		return retryHttp({
			ok: false,
			error: error instanceof Error ? error.message : "Request failed.",
		});
	} finally {
		clearTimeout(timer);
	}
}
