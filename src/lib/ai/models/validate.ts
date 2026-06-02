import type { ProviderId } from "./types";

export type ValidateResult = { ok: true } | { ok: false; error: string };

const TIMEOUT_MS = 12_000;

async function withTimeout(
	run: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		return await run(controller.signal);
	} finally {
		clearTimeout(timer);
	}
}

/** OpenAI-style `GET /v1/models` with Bearer auth (OpenAI, Kimi). */
async function checkOpenAiStyle(
	baseURL: string,
	apiKey: string,
): Promise<ValidateResult> {
	const response = await withTimeout((signal) =>
		fetch(`${baseURL}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal,
		}),
	);
	if (response.ok) return { ok: true };
	if (response.status === 401 || response.status === 403) {
		return { ok: false, error: "Invalid API key." };
	}
	return { ok: false, error: `Provider returned ${response.status}.` };
}

/** Anthropic `GET /v1/models` with `x-api-key` + version header. */
async function checkAnthropic(apiKey: string): Promise<ValidateResult> {
	const response = await withTimeout((signal) =>
		fetch("https://api.anthropic.com/v1/models", {
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			signal,
		}),
	);
	if (response.ok) return { ok: true };
	if (response.status === 401 || response.status === 403) {
		return { ok: false, error: "Invalid API key." };
	}
	return { ok: false, error: `Provider returned ${response.status}.` };
}

/**
 * MiniMax has no `/models` endpoint, so probe the chat endpoint with a tiny
 * request. A 401/403 means the key is bad; any other status (including 400/429)
 * means auth succeeded.
 */
async function checkMiniMax(apiKey: string): Promise<ValidateResult> {
	const response = await withTimeout((signal) =>
		fetch("https://api.minimax.io/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "MiniMax-M3",
				messages: [{ role: "user", content: "ping" }],
				max_tokens: 1,
			}),
			signal,
		}),
	);
	if (response.status === 401 || response.status === 403) {
		return { ok: false, error: "Invalid API key." };
	}
	return { ok: true };
}

/**
 * Validate an API key against the live provider. Returns a `Result`; network
 * failures surface as a friendly error rather than throwing.
 */
export async function validateProviderKey(
	provider: ProviderId,
	apiKey: string,
): Promise<ValidateResult> {
	if (apiKey.trim().length === 0) {
		return { ok: false, error: "API key is empty." };
	}

	try {
		switch (provider) {
			case "openai":
				return await checkOpenAiStyle("https://api.openai.com/v1", apiKey);
			case "kimi":
				return await checkOpenAiStyle("https://api.moonshot.ai/v1", apiKey);
			case "anthropic":
				return await checkAnthropic(apiKey);
			case "minimax":
				return await checkMiniMax(apiKey);
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { ok: false, error: "Validation timed out." };
		}
		return {
			ok: false,
			error:
				error instanceof Error
					? `Could not reach provider: ${error.message}`
					: "Could not reach provider.",
		};
	}
}
