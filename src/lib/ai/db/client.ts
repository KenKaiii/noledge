import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3, { type Database } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { getEnv } from "@/lib/ai/env";
import { migrate } from "./schema";

/**
 * Open a better-sqlite3 connection with the sqlite-vec extension loaded and the
 * schema migrated. Asserts `vec_version()` so a failed native load surfaces with
 * a clear error rather than later, cryptic SQL failures.
 */
export function openDatabase(filePath: string): Database {
	if (filePath !== ":memory:") {
		mkdirSync(dirname(filePath), { recursive: true });
	}

	const db = new BetterSqlite3(filePath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	sqliteVec.load(db);
	const row = db.prepare("SELECT vec_version() AS version").get() as
		| { version: string }
		| undefined;
	if (!row?.version) {
		db.close();
		throw new Error(
			"sqlite-vec extension failed to load: vec_version() returned no value.",
		);
	}

	migrate(db);
	return db;
}

let singleton: Database | null = null;

/** Process-wide singleton connection to the on-disk noledge database. */
export function getDatabase(): Database {
	if (singleton) return singleton;
	singleton = openDatabase(getEnv().dbPath);
	return singleton;
}
