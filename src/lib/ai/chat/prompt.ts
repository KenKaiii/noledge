import type { RetrievedChunk } from "@/lib/ai/rag/retrieve";

const BASE_SYSTEM_PROMPT =
	"You are noledge, a helpful assistant. Answer clearly and concisely using Markdown.";

const RAG_INSTRUCTION =
	"Use the following context from the user's knowledge base to answer the question. " +
	"If the context does not contain the answer, say so and answer from general knowledge. " +
	"Cite sources by their title when you rely on them.";

/**
 * Build the system prompt. When retrieved chunks are present, inject them as
 * grounding context with their source titles.
 */
export function buildSystemPrompt(chunks: RetrievedChunk[]): string {
	if (chunks.length === 0) return BASE_SYSTEM_PROMPT;

	const context = chunks
		.map(
			(chunk, index) =>
				`[${index + 1}] Source: ${chunk.documentTitle}\n${chunk.content}`,
		)
		.join("\n\n---\n\n");

	return `${BASE_SYSTEM_PROMPT}\n\n${RAG_INSTRUCTION}\n\n<context>\n${context}\n</context>`;
}

/** Deduplicate retrieved chunks into source chips (one per document). */
export function toSources(
	chunks: RetrievedChunk[],
): { id: string; href: string; title: string; description: string }[] {
	const seen = new Set<string>();
	const sources: {
		id: string;
		href: string;
		title: string;
		description: string;
	}[] = [];
	for (const chunk of chunks) {
		if (seen.has(chunk.documentId)) continue;
		seen.add(chunk.documentId);
		const snippet = chunk.content.slice(0, 140).trim();
		sources.push({
			id: chunk.documentId,
			href: "/knowledge",
			title: chunk.documentTitle,
			description:
				chunk.content.length > snippet.length ? `${snippet}…` : snippet,
		});
	}
	return sources;
}
