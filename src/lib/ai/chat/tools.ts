import { type Tool, tool } from "ai";
import { z } from "zod";
import { type RetrievedChunk, retrieveChunks } from "@/lib/ai/rag/retrieve";

/** Output returned by the `searchKnowledge` tool on each call. */
export type SearchKnowledgeOutput =
	| { ok: true; chunks: RetrievedChunk[] }
	| { ok: false; error: string; chunks: [] };

export type KnowledgeTools = {
	searchKnowledge: Tool<
		{ query: string; topK?: number },
		SearchKnowledgeOutput
	>;
};

/**
 * Build the per-request knowledge-base tool set. Retrieval runs on demand when
 * the model calls `searchKnowledge`, so the corpus is never loaded into the
 * prompt — only the passages the model asks for. The request `signal` is closed
 * over so in-flight embeddings/queries abort with the connection.
 */
export function createKnowledgeTools(signal: AbortSignal): KnowledgeTools {
	return {
		searchKnowledge: tool({
			description:
				"Search the user's ingested knowledge base (documents they uploaded) " +
				"for passages relevant to a query. Call this whenever the answer may " +
				"depend on the user's own documents. You may call it several times " +
				"with refined queries to gather enough context before answering. " +
				"Cite the returned source titles when you rely on them.",
			inputSchema: z.object({
				query: z
					.string()
					.min(1)
					.describe("A focused natural-language search query."),
				topK: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe("How many passages to retrieve. Defaults to 5."),
			}),
			execute: async ({ query, topK }): Promise<SearchKnowledgeOutput> => {
				const retrieved = await retrieveChunks(query, {
					signal,
					topK: topK ?? 5,
				});
				if (!retrieved.ok) {
					return { ok: false, error: retrieved.error, chunks: [] };
				}
				return { ok: true, chunks: retrieved.chunks };
			},
		}),
	};
}
