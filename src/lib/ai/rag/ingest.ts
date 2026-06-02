import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";
import { embedTexts, toVectorBlob } from "@/lib/ai/embeddings/embed";
import { type ChunkOptions, chunkText } from "./chunk";
import { extractText } from "./extract";

/** Embeds a batch of strings into vectors. Injectable for tests. */
export type Embedder = (
	values: string[],
	signal?: AbortSignal,
) => Promise<
	{ ok: true; embeddings: number[][] } | { ok: false; error: string }
>;

export type IngestInput = {
	data: Buffer;
	filename: string;
	mime: string;
	title?: string;
};

export type IngestResult =
	| { ok: true; documentId: string; chunks: number }
	| { ok: false; error: string };

export type IngestOptions = {
	db?: Database;
	embedder?: Embedder;
	chunkOptions?: ChunkOptions;
	signal?: AbortSignal;
};

/**
 * Ingest a document: extract text → chunk → embed → store rows + vectors in a
 * single transaction. Returns a `Result`.
 */
export async function ingestDocument(
	input: IngestInput,
	options: IngestOptions = {},
): Promise<IngestResult> {
	const db = options.db ?? getDatabase();
	const embedder = options.embedder ?? embedTexts;

	const extracted = await extractText(
		input.data,
		input.filename,
		input.mime,
		options.signal,
	);
	if (!extracted.ok) return { ok: false, error: extracted.error };

	const chunks = chunkText(extracted.text, options.chunkOptions);
	if (chunks.length === 0) {
		return { ok: false, error: "No extractable text found in document." };
	}

	const embedded = await embedder(chunks, options.signal);
	if (!embedded.ok) return { ok: false, error: embedded.error };
	if (embedded.embeddings.length !== chunks.length) {
		return { ok: false, error: "Embedding count did not match chunk count." };
	}

	const documentId = randomUUID();
	const title = input.title?.trim() || input.filename;

	const insertDocument = db.prepare(
		"INSERT INTO documents (id, title, filename, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
	);
	const insertChunk = db.prepare(
		"INSERT INTO chunks (id, document_id, ordinal, content) VALUES (?, ?, ?, ?)",
	);
	const insertVec = db.prepare(
		"INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)",
	);

	const transaction = db.transaction(() => {
		insertDocument.run(
			documentId,
			title,
			input.filename,
			input.mime,
			input.data.byteLength,
			Date.now(),
		);
		chunks.forEach((content, ordinal) => {
			const chunkId = randomUUID();
			const embedding = embedded.embeddings[ordinal];
			if (!embedding) throw new Error("Missing embedding for chunk.");
			insertChunk.run(chunkId, documentId, ordinal, content);
			insertVec.run(chunkId, toVectorBlob(embedding));
		});
	});

	try {
		transaction();
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error ? error.message : "Failed to store document.",
		};
	}

	return { ok: true, documentId, chunks: chunks.length };
}
