import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";

export type AppSettingKey =
	| "agent.systemPrompt"
	| "agent.aboutUser"
	| "agent.responseStyle"
	| "rag.rerankEnabled"
	| "rag.rerankApiKey"
	| "rag.rerankModel";

export function getAppSetting(
	key: AppSettingKey,
	db: Database = getDatabase(),
): string | null {
	const row = db
		.prepare("SELECT value FROM app_settings WHERE key = ?")
		.get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

export function setAppSetting(
	key: AppSettingKey,
	value: string,
	db: Database = getDatabase(),
): void {
	db.prepare(
		`INSERT INTO app_settings (key, value, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at`,
	).run(key, value, Date.now());
}

export function deleteAppSetting(
	key: AppSettingKey,
	db: Database = getDatabase(),
): void {
	db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}
