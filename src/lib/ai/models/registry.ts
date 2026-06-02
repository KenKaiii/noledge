import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { resolveProviderKey } from "./provider-config";
import {
	findModel,
	MODEL_CATALOG,
	type ModelCatalogEntry,
	type ModelId,
	PROVIDER_IDS,
	type ProviderId,
} from "./types";

export type ResolveModelResult =
	| { ok: true; model: LanguageModel }
	| { ok: false; error: string };

/** Which providers have an API key configured (local or system). */
function configuredProviders(): Set<ProviderId> {
	const set = new Set<ProviderId>();
	for (const provider of PROVIDER_IDS) {
		if (resolveProviderKey(provider).key) set.add(provider);
	}
	return set;
}

/** Catalog entries whose provider has a configured key. */
export function availableModels(): ModelCatalogEntry[] {
	const providers = configuredProviders();
	return MODEL_CATALOG.filter((entry) => providers.has(entry.provider));
}

/** The default model id, preferring an available provider. */
export function defaultModelId(): ModelId | undefined {
	const available = availableModels();
	return (available.find((entry) => entry.default) ?? available[0])?.id;
}

function instantiate(entry: ModelCatalogEntry): LanguageModel {
	const apiKey = resolveProviderKey(entry.provider).key;
	switch (entry.provider) {
		case "openai": {
			const openai = createOpenAI({ apiKey });
			return openai(entry.id);
		}
		case "anthropic": {
			const anthropic = createAnthropic({ apiKey });
			return anthropic(entry.id);
		}
		case "kimi": {
			const kimi = createOpenAICompatible({
				name: "moonshot",
				baseURL: "https://api.moonshot.ai/v1",
				apiKey,
			});
			return kimi(entry.id);
		}
		case "minimax": {
			const minimax = createOpenAICompatible({
				name: "minimax",
				baseURL: "https://api.minimax.io/v1",
				apiKey,
			});
			return minimax(entry.id);
		}
	}
}

/**
 * Resolve a model id to an AI SDK `LanguageModel`. Falls back to the default when
 * `id` is undefined. Returns a `Result` for unknown ids or unconfigured providers.
 */
export function resolveModel(id?: string): ResolveModelResult {
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

	return { ok: true, model: instantiate(entry) };
}
