import type { Database } from "better-sqlite3";
import { decryptSecret, encryptSecret } from "@/lib/ai/crypto/secrets";
import { getDatabase } from "@/lib/ai/db/client";

export type AppSettingKey =
	| "agent.systemPrompt"
	| "agent.aboutUser"
	| "agent.responseStyle"
	| "rag.rerankEnabled"
	| "rag.rerankApiKey"
	| "rag.rerankModel";

/** Setting keys whose values are secrets and are encrypted at rest. */
const SECRET_KEYS = new Set<AppSettingKey>(["rag.rerankApiKey"]);

export function getAppSetting(
	key: AppSettingKey,
	db: Database = getDatabase(),
): string | null {
	const row = db
		.prepare("SELECT value FROM app_settings WHERE key = ?")
		.get(key) as { value: string } | undefined;
	if (row?.value === undefined) return null;
	return SECRET_KEYS.has(key) ? decryptSecret(row.value) : row.value;
}

export function setAppSetting(
	key: AppSettingKey,
	value: string,
	db: Database = getDatabase(),
): void {
	const stored = SECRET_KEYS.has(key) ? encryptSecret(value) : value;
	db.prepare(
		`INSERT INTO app_settings (key, value, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at`,
	).run(key, stored, Date.now());
}

export function deleteAppSetting(
	key: AppSettingKey,
	db: Database = getDatabase(),
): void {
	db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}
