import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";
import { getEnv } from "@/lib/ai/env";
import type { ProviderId } from "./types";

/**
 * Provider connection config: how a key is sourced, validated, and where it
 * resolves an API key from. Keys can come from the system environment (read-only)
 * or be stored locally in the sqlite `provider_keys` table (user-managed via UI).
 *
 * Locally stored keys take precedence over env so a user can override a system
 * key from the UI.
 */

export type KeySource = "system" | "local" | "none";

export type ProviderMeta = {
	id: ProviderId;
	label: string;
	/** Environment variable consulted for a system-provided key. */
	envVar: string;
	/** Help text shown in the UI for obtaining a key. */
	hint: string;
	/** Expected key prefix for lightweight client-side format hints (optional). */
	keyPrefix?: string;
};

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
	openai: {
		id: "openai",
		label: "OpenAI",
		envVar: "OPENAI_API_KEY",
		hint: "Required for embeddings and GPT models. platform.openai.com",
		keyPrefix: "sk-",
	},
	anthropic: {
		id: "anthropic",
		label: "Anthropic",
		envVar: "ANTHROPIC_API_KEY",
		hint: "Claude models. console.anthropic.com",
		keyPrefix: "sk-ant-",
	},
	kimi: {
		id: "kimi",
		label: "Moonshot (Kimi)",
		envVar: "MOONSHOT_API_KEY",
		hint: "Kimi models. platform.moonshot.ai",
	},
	minimax: {
		id: "minimax",
		label: "MiniMax",
		envVar: "MINIMAX_API_KEY",
		hint: "MiniMax models. platform.minimax.io",
	},
};

function envKeyFor(provider: ProviderId): string | undefined {
	const env = getEnv();
	switch (provider) {
		case "openai":
			return env.OPENAI_API_KEY;
		case "anthropic":
			return env.ANTHROPIC_API_KEY;
		case "kimi":
			return env.MOONSHOT_API_KEY;
		case "minimax":
			return env.MINIMAX_API_KEY;
	}
}

type KeyRow = { api_key: string };

function localKeyFor(provider: ProviderId, db: Database): string | undefined {
	try {
		const row = db
			.prepare("SELECT api_key FROM provider_keys WHERE provider = ?")
			.get(provider) as KeyRow | undefined;
		return row?.api_key;
	} catch {
		return undefined;
	}
}

/**
 * Resolve the active API key for a provider and its source. Local (UI-stored)
 * keys win over system (env) keys.
 */
export function resolveProviderKey(
	provider: ProviderId,
	db: Database = getDatabase(),
): { key: string | undefined; source: KeySource } {
	const local = localKeyFor(provider, db);
	if (local) return { key: local, source: "local" };

	const system = envKeyFor(provider);
	if (system) return { key: system, source: "system" };

	return { key: undefined, source: "none" };
}

/** Persist a user-provided key for a provider (upsert). */
export function saveProviderKey(
	provider: ProviderId,
	apiKey: string,
	db: Database = getDatabase(),
): void {
	db.prepare(
		`INSERT INTO provider_keys (provider, api_key, created_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(provider) DO UPDATE SET api_key = excluded.api_key, created_at = excluded.created_at`,
	).run(provider, apiKey, Date.now());
}

/** Remove a user-provided key. Returns true if a row was deleted. */
export function deleteProviderKey(
	provider: ProviderId,
	db: Database = getDatabase(),
): boolean {
	const info = db
		.prepare("DELETE FROM provider_keys WHERE provider = ?")
		.run(provider);
	return info.changes > 0;
}

/** Mask a key for display: keep the first 3 and last 4 characters. */
export function maskKey(key: string): string {
	if (key.length <= 8) return "••••";
	return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
