/**
 * Central model catalog. Every model id the app can use lives here so version
 * bumps (providers iterate fast) are a one-line change rather than scattered
 * string literals across routes.
 */

export const PROVIDER_IDS = ["openai", "anthropic", "kimi", "minimax"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ModelCatalogEntry = {
	id: string;
	provider: ProviderId;
	label: string;
	/** Default model id for the provider (sent when no model is specified). */
	default: boolean;
};

/**
 * Default model ids per provider (verified June 2026). Override via env if a
 * provider ships a newer snapshot.
 */
export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
	{ id: "gpt-5.5", provider: "openai", label: "GPT-5.5", default: true },
	{
		id: "claude-opus-4-8",
		provider: "anthropic",
		label: "Claude Opus 4.8",
		default: true,
	},
	{ id: "kimi-k2.6", provider: "kimi", label: "Kimi K2.6", default: true },
	{
		id: "MiniMax-M3",
		provider: "minimax",
		label: "MiniMax M3",
		default: true,
	},
] as const;

export type ModelId = (typeof MODEL_CATALOG)[number]["id"];

const MODEL_IDS = new Set(MODEL_CATALOG.map((entry) => entry.id));

/** Narrow an arbitrary string to a known catalog model id. */
export function isModelId(value: string): value is ModelId {
	return MODEL_IDS.has(value);
}

/** Look up the catalog entry for a model id, if known. */
export function findModel(id: string): ModelCatalogEntry | undefined {
	return MODEL_CATALOG.find((entry) => entry.id === id);
}
