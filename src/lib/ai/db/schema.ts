import type { Database } from "better-sqlite3";

/**
 * Embedding dimensionality. Hard-coded into the `vec_chunks` virtual table.
 *
 * WARNING: this is locked to OpenAI `text-embedding-3-small` (1536). Switching to
 * an embedding model with a different dimension requires dropping/recreating
 * `vec_chunks` (a destructive migration) — there is no in-place resize.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Create the schema if it does not yet exist. Idempotent — safe to call on every
 * connection open.
 */
export function migrate(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS documents (
			id         TEXT PRIMARY KEY,
			title      TEXT NOT NULL,
			filename   TEXT NOT NULL,
			mime       TEXT NOT NULL,
			bytes      INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS chunks (
			id          TEXT PRIMARY KEY,
			document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			ordinal     INTEGER NOT NULL,
			content     TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

		CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
			chunk_id TEXT PRIMARY KEY,
			embedding float[${EMBEDDING_DIMENSIONS}] distance_metric=cosine
		);

		CREATE TABLE IF NOT EXISTS provider_keys (
			provider   TEXT PRIMARY KEY,
			api_key    TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS conversations (
			id         TEXT PRIMARY KEY,
			title      TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS conversation_messages (
			id              TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
			role            TEXT NOT NULL,
			content         TEXT NOT NULL,
			ordinal         INTEGER NOT NULL,
			created_at      INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id);
	`);
}
