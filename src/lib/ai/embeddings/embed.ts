import { createOpenAI } from "@ai-sdk/openai";
import { type EmbeddingModel, embedMany } from "ai";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/db/schema";
import { resolveProviderKey } from "@/lib/ai/models/provider-config";

/** OpenAI embedding model id locked to the dimension of the vec table. */
export const EMBEDDING_MODEL_ID = "text-embedding-3-small";

export type EmbedResult =
	| { ok: true; embeddings: number[][] }
	| { ok: false; error: string };

/** Resolve the configured embedding model. Throws if no OpenAI key is set. */
export function getEmbeddingModel(): EmbeddingModel {
	const { key } = resolveProviderKey("openai");
	if (!key) {
		throw new Error(
			"An OpenAI API key is required for embeddings (text-embedding-3-small).",
		);
	}
	const openai = createOpenAI({ apiKey: key });
	return openai.embedding(EMBEDDING_MODEL_ID);
}

/**
 * Embed a batch of strings. Returns a `Result` so callers can handle the common
 * "missing key / provider error" failure without try/catch.
 */
export async function embedTexts(
	values: string[],
	signal?: AbortSignal,
): Promise<EmbedResult> {
	if (values.length === 0) return { ok: true, embeddings: [] };

	try {
		const model = getEmbeddingModel();
		const { embeddings } = await embedMany({
			model,
			values,
			abortSignal: signal,
		});

		for (const vector of embeddings) {
			if (vector.length !== EMBEDDING_DIMENSIONS) {
				return {
					ok: false,
					error: `Expected ${EMBEDDING_DIMENSIONS}-dim embeddings, got ${vector.length}.`,
				};
			}
		}

		return { ok: true, embeddings };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Embedding failed.",
		};
	}
}

/** Encode an embedding vector for sqlite-vec binding (`float[]` blob). */
export function toVectorBlob(embedding: number[]): Buffer {
	return Buffer.from(new Float32Array(embedding).buffer);
}
