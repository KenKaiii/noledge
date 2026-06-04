import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import { kimiCodingHeaders } from "./oauth";
import { type KeySource, resolveProviderCredential } from "./provider-config";
import {
	findModel,
	MODEL_CATALOG,
	type ModelCatalogEntry,
	type ModelId,
	PROVIDER_IDS,
	type ProviderId,
} from "./types";

const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<ProviderId, string>> = {
	gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
	kimi: "https://api.moonshot.ai/v1",
	glm: "https://api.z.ai/api/coding/paas/v4",
	xiaomi: "https://token-plan-sgp.xiaomimimo.com/v1",
	deepseek: "https://api.deepseek.com/v1",
	openrouter: "https://openrouter.ai/api/v1",
};

export type ResolveModelResult =
	| {
			ok: true;
			model: LanguageModel;
			/** Whether the resolved model streams a reasoning trace. */
			reasoning: boolean;
			/** Whether the resolved model accepts native image inputs. */
			supportsVision: boolean;
			/** Provider-specific options (e.g. enabling thinking/reasoning summaries). */
			providerOptions: ProviderOptions | undefined;
			provider: ProviderId;
			credentialSource: KeySource;
	  }
	| { ok: false; error: string };

/** Which providers have credentials configured (OAuth, local key, or system key). */
function configuredProviders(): Set<ProviderId> {
	const set = new Set<ProviderId>();
	for (const provider of PROVIDER_IDS) {
		if (resolveProviderCredential(provider).key) set.add(provider);
	}
	return set;
}

/** Catalog entries whose provider has configured credentials. */
export function availableModels(): ModelCatalogEntry[] {
	const providers = configuredProviders();
	return MODEL_CATALOG.filter((entry) => providers.has(entry.provider));
}

/** The default model id, preferring an available provider. */
export function defaultModelId(): ModelId | undefined {
	const available = availableModels();
	return (available.find((entry) => entry.default) ?? available[0])?.id;
}

/**
 * Build provider-specific options for a model's reasoning trace, honoring the
 * user's thinking toggle. Returns undefined when the model has no reasoning
 * capability or when no provider options are needed.
 *
 * - Anthropic: opt-in. `thinking` extended reasoning (budget counts toward
 *   max_tokens; minimum 1024); `sendReasoning` forwards the trace on follow-up
 *   turns. Disabled => omit (the model does not think by default).
 * - OpenAI (Responses API): opt-in. `reasoningSummary: "auto"` streams a
 *   summarized reasoning trace (raw chain-of-thought is never exposed). Disabled
 *   => omit, so no summary is surfaced.
 * - Kimi (Moonshot, OpenAI-compatible): thinking is ON by default, so disabling
 *   MUST send `thinking: { type: "disabled" }` explicitly. The `thinking` field
 *   is passed through to the request body verbatim by the provider.
 */
function reasoningProviderOptions(
	entry: ModelCatalogEntry,
	enabled: boolean,
): ProviderOptions | undefined {
	if (!entry.reasoning) return undefined;
	switch (entry.provider) {
		case "anthropic":
			return enabled
				? {
						anthropic: {
							thinking: { type: "enabled", budgetTokens: 4096 },
							sendReasoning: true,
						},
					}
				: undefined;
		case "openai":
			return enabled
				? {
						openai: {
							reasoningSummary: "auto",
							reasoningEffort: "medium",
						},
					}
				: undefined;
		case "kimi":
			return {
				moonshot: {
					thinking: { type: enabled ? "enabled" : "disabled" },
				},
			};
		default:
			return undefined;
	}
}

function createOpenAICompatibleModel(
	provider: ProviderId,
	modelId: string,
	apiKey: string | undefined,
	baseURLOverride?: string,
): LanguageModel {
	const baseURL = baseURLOverride ?? OPENAI_COMPATIBLE_BASE_URLS[provider];
	if (!baseURL) {
		throw new Error(`Provider ${provider} is not OpenAI-compatible.`);
	}
	const compatible = createOpenAICompatible({
		name: provider === "kimi" ? "moonshot" : provider,
		baseURL,
		...(apiKey ? { apiKey } : {}),
		...(provider === "kimi" && baseURL.includes("api.kimi.com")
			? { headers: kimiCodingHeaders() }
			: {}),
	});
	return compatible(modelId);
}

function instantiate(entry: ModelCatalogEntry): LanguageModel {
	const credential = resolveProviderCredential(entry.provider);
	switch (entry.provider) {
		case "openai": {
			const openai = createOpenAI({
				...(credential.key ? { apiKey: credential.key } : {}),
				...(credential.baseURL ? { baseURL: credential.baseURL } : {}),
			});
			return openai(entry.id);
		}
		case "anthropic": {
			const anthropic = createAnthropic(
				credential.source === "oauth"
					? {
							...(credential.key ? { authToken: credential.key } : {}),
							...(credential.baseURL ? { baseURL: credential.baseURL } : {}),
							headers: {
								"anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
								"user-agent": "claude-cli/2.1.88 (external, cli)",
								"x-app": "cli",
							},
						}
					: {
							...(credential.key ? { apiKey: credential.key } : {}),
							...(credential.baseURL ? { baseURL: credential.baseURL } : {}),
						},
			);
			return anthropic(entry.id);
		}
		case "minimax": {
			const minimax = createAnthropic({
				...(credential.key ? { apiKey: credential.key } : {}),
				baseURL: credential.baseURL ?? "https://api.minimax.io/anthropic",
			});
			return minimax(entry.id);
		}
		case "gemini":
		case "kimi":
		case "glm":
		case "xiaomi":
		case "deepseek":
		case "openrouter":
			return createOpenAICompatibleModel(
				entry.provider,
				entry.id,
				credential.key,
				credential.baseURL,
			);
	}
}

/**
 * Resolve a model id to an AI SDK `LanguageModel`. Falls back to the default when
 * `id` is undefined. Returns a `Result` for unknown ids or unconfigured providers.
 */
export function resolveModel(
	id?: string,
	opts?: { thinking?: boolean },
): ResolveModelResult {
	const thinkingEnabled = opts?.thinking ?? true;
	const targetId = id ?? defaultModelId();
	if (!targetId) {
		return {
			ok: false,
			error: "No model available — configure at least one provider API key.",
		};
	}

	const entry = findModel(targetId);
	if (!entry) {
		return { ok: false, error: `Unknown model id: ${targetId}` };
	}

	if (!configuredProviders().has(entry.provider)) {
		return {
			ok: false,
			error: `Provider "${entry.provider}" is not configured (missing API key).`,
		};
	}

	const credential = resolveProviderCredential(entry.provider);
	return {
		ok: true,
		model: instantiate(entry),
		reasoning: entry.reasoning ?? false,
		supportsVision: entry.vision ?? false,
		providerOptions: reasoningProviderOptions(entry, thinkingEnabled),
		provider: entry.provider,
		credentialSource: credential.source,
	};
}
