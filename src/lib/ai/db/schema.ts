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

		CREATE TABLE IF NOT EXISTS app_settings (
			key        TEXT PRIMARY KEY,
			value      TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);
	
		CREATE TABLE IF NOT EXISTS provider_oauth_credentials (
			provider      TEXT PRIMARY KEY,
			access_token  TEXT NOT NULL,
			refresh_token TEXT,
			expires_at    INTEGER,
			base_url      TEXT,
			created_at    INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS provider_oauth_states (
			id          TEXT PRIMARY KEY,
			provider    TEXT NOT NULL,
			state       TEXT,
			verifier    TEXT,
			device_code TEXT,
			expires_at  INTEGER NOT NULL,
			created_at  INTEGER NOT NULL
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

		CREATE TABLE IF NOT EXISTS automation_sources (
			id              TEXT PRIMARY KEY,
			type            TEXT NOT NULL,          -- 'rss' | 'youtube' | 'arxiv' | 'openalex' | 'pubmed' | 'biorxiv' | 'medrxiv'
			url             TEXT NOT NULL,          -- feed/channel URL or paper query (e.g. 'cat:cs.AI', 'large language models')
			identifier      TEXT,                   -- resolved channelId (UC...) or paper mode ('category' | 'keyword' | 'title')
			title           TEXT,                   -- resolved feed/channel title
			enabled         INTEGER NOT NULL DEFAULT 1,
			created_at      INTEGER NOT NULL,
			last_polled_at  INTEGER,
			last_status     TEXT,                   -- 'ok' | 'error' | 'partial'
			last_error      TEXT,
			last_item_count INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS automation_config (
			id            INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
			schedule_hour INTEGER,               -- 0..23, NULL = disabled
			timezone      TEXT,                  -- IANA tz, e.g. 'Europe/London'
			last_run_at   INTEGER
		);
	`);

	addChunkSpanColumns(db);
	addDocumentProvenanceColumns(db);
	createDocumentDateIndex(db);
	createChunksFts(db);
}

/**
 * Add nullable provenance columns to `documents` if absent — they tie an ingested
 * document back to the automation source it came from and enable dedup. Manual
 * uploads leave source_id/external_id/source_url NULL but still record
 * content_hash for upload-level dedup. SQLite has no `ADD COLUMN IF NOT EXISTS`,
 * so we detect via `PRAGMA table_info` first, then create the partial unique index
 * that guards against re-ingesting the same `(source_id, external_id)` pair plus a
 * lookup index over content_hash.
 */
function createDocumentDateIndex(db: Database): void {
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_documents_document_date ON documents(COALESCE(published_at, created_at), created_at)",
	);
}

function addDocumentProvenanceColumns(db: Database): void {
	const columns = db.prepare("PRAGMA table_info(documents)").all() as {
		name: string;
	}[];
	const present = new Set(columns.map((column) => column.name));
	if (!present.has("source_id")) {
		db.exec("ALTER TABLE documents ADD COLUMN source_id TEXT");
	}
	if (!present.has("external_id")) {
		db.exec("ALTER TABLE documents ADD COLUMN external_id TEXT");
	}
	if (!present.has("source_url")) {
		db.exec("ALTER TABLE documents ADD COLUMN source_url TEXT");
	}
	// SHA-256 of the extracted text, used to dedup manual uploads (which have no
	// source_id/external_id to key on). Stored for every document; the dedup check
	// only consults it for manual uploads (source_id IS NULL).
	if (!present.has("content_hash")) {
		db.exec("ALTER TABLE documents ADD COLUMN content_hash TEXT");
	}
	// Publication timestamp from the external source, when available. Date-aware
	// retrieval falls back to created_at for uploads/sources without publish dates.
	if (!present.has("published_at")) {
		db.exec("ALTER TABLE documents ADD COLUMN published_at INTEGER");
	}
	// Dedup guard: a given source can hold at most one document per external id.
	// Manual uploads (external_id IS NULL) are unaffected by the partial index.
	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_source_external ON documents(source_id, external_id) WHERE external_id IS NOT NULL",
	);
	// Lookup index for manual-upload content dedup.
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash) WHERE content_hash IS NOT NULL",
	);
}

/**
 * Add nullable `start`/`end` char-offset columns to `chunks` if absent. SQLite
 * does not support `ADD COLUMN IF NOT EXISTS`, so detect via `PRAGMA table_info`
 * before issuing `ALTER TABLE`.
 */
function addChunkSpanColumns(db: Database): void {
	const columns = db.prepare("PRAGMA table_info(chunks)").all() as {
		name: string;
	}[];
	const present = new Set(columns.map((column) => column.name));
	if (!present.has("start")) {
		db.exec("ALTER TABLE chunks ADD COLUMN start INTEGER");
	}
	if (!present.has("end")) {
		db.exec("ALTER TABLE chunks ADD COLUMN end INTEGER");
	}
}

/**
 * Create the FTS5 keyword index mirroring `chunks.content`, keyed on the implicit
 * `rowid` (external-content table), plus triggers that keep it in sync with the
 * `chunks` table on every insert/update/delete.
 *
 * The delete/update triggers use the FTS5 `'delete'` command
 * (`INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', ...)`),
 * which is mandatory for external-content tables: a plain `DELETE` cannot remove
 * the correct postings because FTS5 needs the original column values, and doing
 * so leaves the index malformed. With triggers in place, ingest/delete code paths
 * touch only `chunks` and the index follows automatically.
 *
 * For databases that predate the FTS table the index starts empty; detect that
 * and run the FTS5 `'rebuild'` command once to backfill from the content table.
 *
 * All of this is wrapped in try/catch: if the better-sqlite3 build lacks FTS5,
 * retrieval degrades to vector-only at query time rather than failing to open the
 * database.
 */
function createChunksFts(db: Database): void {
	try {
		db.exec(
			`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
				content,
				content='chunks',
				content_rowid='rowid',
				tokenize='unicode61'
			);

			CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
				INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
			END;

			CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
				INSERT INTO chunks_fts(chunks_fts, rowid, content)
				VALUES ('delete', old.rowid, old.content);
			END;

			CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks BEGIN
				INSERT INTO chunks_fts(chunks_fts, rowid, content)
				VALUES ('delete', old.rowid, old.content);
				INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
			END;`,
		);

		const chunkCount = (
			db.prepare("SELECT COUNT(*) AS count FROM chunks").get() as {
				count: number;
			}
		).count;
		if (chunkCount === 0) return;

		// Probe whether the index already resolves a known chunk; if not, it predates
		// the FTS table (or was never built) and needs a one-time rebuild. The probe
		// keys on a chunk's own first token so it works for any corpus.
		const sample = db
			.prepare("SELECT rowid, content FROM chunks LIMIT 1")
			.get() as { rowid: number; content: string } | undefined;
		if (!sample) return;
		const token = sample.content.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0];
		if (!token) return;
		const hit = db
			.prepare(
				"SELECT 1 FROM chunks_fts WHERE chunks_fts MATCH ? AND rowid = ? LIMIT 1",
			)
			.get(`"${token}"`, sample.rowid);
		if (hit === undefined) {
			db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
		}
	} catch {
		// FTS5 unavailable in this SQLite build — hybrid search falls back to
		// vector-only at query time (keyword arm guards on table existence).
	}
}
