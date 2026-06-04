import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";
import { getEnv } from "@/lib/ai/env";
import type { ProviderId } from "./types";

/**
 * Provider connection config: how a key is sourced, validated, and where it
 * resolves an API key from. Keys can come from the system environment (read-only)
 * or be stored locally in the sqlite `provider_keys` table (user-managed via UI).
 *
 * OAuth credentials are preferred over API keys for chat providers. Locally
 * stored API keys take precedence over env so a user can override a system key
 * from the UI when OAuth is absent.
 */

export type KeySource = "oauth" | "system" | "local" | "none";

export type ProviderMeta = {
	id: ProviderId;
	label: string;
	/** Environment variable consulted for a system-provided key. */
	envVar: string;
	/** Help text shown in the UI for obtaining a key. */
	hint: string;
	/** Expected key prefix for lightweight client-side format hints (optional). */
	keyPrefix?: string;
	/** Whether this provider supports browser/device OAuth login in this app. */
	oauth?: boolean;
};

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
	openai: {
		id: "openai",
		label: "OpenAI",
		envVar: "OPENAI_API_KEY",
		hint: "https://platform.openai.com/api-keys",
		keyPrefix: "sk-",
		oauth: true,
	},
	anthropic: {
		id: "anthropic",
		label: "Anthropic",
		envVar: "ANTHROPIC_API_KEY",
		hint: "https://console.anthropic.com/settings/keys",
		keyPrefix: "sk-ant-",
		oauth: true,
	},
	gemini: {
		id: "gemini",
		label: "Google Gemini",
		envVar: "GEMINI_API_KEY",
		hint: "https://aistudio.google.com/app/apikey",
	},
	kimi: {
		id: "kimi",
		label: "Moonshot (Kimi)",
		envVar: "MOONSHOT_API_KEY",
		hint: "https://platform.moonshot.ai/console/api-keys",
		oauth: true,
	},
	glm: {
		id: "glm",
		label: "Z.AI (GLM)",
		envVar: "GLM_API_KEY",
		hint: "https://docs.z.ai/guides/llm/glm-coding-plan",
	},
	minimax: {
		id: "minimax",
		label: "MiniMax",
		envVar: "MINIMAX_API_KEY",
		hint: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
	},
	xiaomi: {
		id: "xiaomi",
		label: "Xiaomi MiMo",
		envVar: "XIAOMI_API_KEY",
		hint: "https://platform.xiaomimimo.com/token-plan",
	},
	deepseek: {
		id: "deepseek",
		label: "DeepSeek",
		envVar: "DEEPSEEK_API_KEY",
		hint: "https://platform.deepseek.com/api_keys",
	},
	openrouter: {
		id: "openrouter",
		label: "OpenRouter",
		envVar: "OPENROUTER_API_KEY",
		hint: "https://openrouter.ai/settings/keys",
	},
};

function envKeyFor(provider: ProviderId): string | undefined {
	const env = getEnv();
	switch (provider) {
		case "openai":
			return env.OPENAI_API_KEY;
		case "anthropic":
			return env.ANTHROPIC_API_KEY;
		case "gemini":
			return env.GEMINI_API_KEY;
		case "kimi":
			return env.MOONSHOT_API_KEY;
		case "glm":
			return env.GLM_API_KEY;
		case "minimax":
			return env.MINIMAX_API_KEY;
		case "xiaomi":
			return env.XIAOMI_API_KEY;
		case "deepseek":
			return env.DEEPSEEK_API_KEY;
		case "openrouter":
			return env.OPENROUTER_API_KEY;
	}
}

type KeyRow = { api_key: string };

type OAuthRow = {
	access_token: string;
	refresh_token: string | null;
	expires_at: number | null;
	base_url: string | null;
};

export type ProviderCredential = {
	key: string | undefined;
	source: KeySource;
	baseURL?: string;
};

export type ProviderOAuthCredential = {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	baseURL?: string;
};

export type ProviderOAuthCredentialRow = OAuthRow;

export function getProviderOAuthCredential(
	provider: ProviderId,
	db: Database = getDatabase(),
): ProviderOAuthCredentialRow | undefined {
	try {
		const row = db
			.prepare(
				"SELECT access_token, refresh_token, expires_at, base_url FROM provider_oauth_credentials WHERE provider = ?",
			)
			.get(provider) as OAuthRow | undefined;
		if (!row?.access_token) return undefined;
		return row;
	} catch {
		return undefined;
	}
}

function oauthFor(provider: ProviderId, db: Database): OAuthRow | undefined {
	return getProviderOAuthCredential(provider, db);
}

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

/** Resolve API-key credentials only. Used by embeddings and key management. */
export function resolveProviderKey(
	provider: ProviderId,
	db: Database = getDatabase(),
): ProviderCredential {
	const local = localKeyFor(provider, db);
	if (local) return { key: local, source: "local" };

	const system = envKeyFor(provider);
	if (system) return { key: system, source: "system" };

	return { key: undefined, source: "none" };
}

/** Resolve chat credentials. OAuth always wins over API keys when present. */
export function resolveProviderCredential(
	provider: ProviderId,
	db: Database = getDatabase(),
): ProviderCredential {
	const oauth = oauthFor(provider, db);
	if (oauth) {
		return {
			key: oauth.access_token,
			source: "oauth",
			...(oauth.base_url ? { baseURL: oauth.base_url } : {}),
		};
	}

	return resolveProviderKey(provider, db);
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

/** Persist OAuth credentials for a provider. OAuth is preferred by chat. */
export function saveProviderOAuthCredential(
	provider: ProviderId,
	credential: ProviderOAuthCredential,
	db: Database = getDatabase(),
): void {
	db.prepare(
		`INSERT INTO provider_oauth_credentials (provider, access_token, refresh_token, expires_at, base_url, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(provider) DO UPDATE SET
			access_token = excluded.access_token,
			refresh_token = excluded.refresh_token,
			expires_at = excluded.expires_at,
			base_url = excluded.base_url,
			created_at = excluded.created_at`,
	).run(
		provider,
		credential.accessToken,
		credential.refreshToken ?? null,
		credential.expiresAt ?? null,
		credential.baseURL ?? null,
		Date.now(),
	);
}

/** Remove stored OAuth credentials. Returns true if a row was deleted. */
export function deleteProviderOAuthCredential(
	provider: ProviderId,
	db: Database = getDatabase(),
): boolean {
	const info = db
		.prepare("DELETE FROM provider_oauth_credentials WHERE provider = ?")
		.run(provider);
	return info.changes > 0;
}

/** Mask a key for display: keep the first 3 and last 4 characters. */
export function maskKey(key: string): string {
	if (key.length <= 8) return "••••";
	return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
