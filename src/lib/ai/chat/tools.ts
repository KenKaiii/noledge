import { type Tool, tool } from "ai";
import { z } from "zod";
import { getDatabase } from "@/lib/ai/db/client";
import { type RetrievedChunk, retrieveChunks } from "@/lib/ai/rag/retrieve";

/** Output returned by the `searchKnowledge` tool on each call. */
export type SearchKnowledgeOutput =
	| { ok: true; chunks: RetrievedChunk[] }
	| { ok: false; error: string; chunks: [] };

export type RecentDocument = {
	id: string;
	title: string;
	filename: string;
	createdAt: number;
	publishedAt?: number;
	date: number;
};

export type ListRecentDocumentsOutput =
	| { ok: true; documents: RecentDocument[] }
	| { ok: false; error: string; documents: [] };

export type KnowledgeTools = {
	searchKnowledge: Tool<
		{ query: string; topK?: number; dateFrom?: string; dateTo?: string },
		SearchKnowledgeOutput
	>;
	listRecentDocuments: Tool<
		{ dateFrom?: string; dateTo?: string; limit?: number },
		ListRecentDocumentsOutput
	>;
};

function parseDateBound(
	value: string | undefined,
	bound: "from" | "to",
): number | undefined {
	if (value === undefined || value.trim().length === 0) return undefined;
	const trimmed = value.trim();
	const ms = Date.parse(trimmed);
	if (Number.isNaN(ms)) return undefined;
	if (bound === "to" && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return ms + 24 * 60 * 60 * 1000 - 1;
	}
	return ms;
}

/**
 * Build the per-request knowledge-base tool set. Retrieval runs on demand when
 * the model calls `searchKnowledge`, so the corpus is never loaded into the
 * prompt — only the passages the model asks for. The request `signal` is closed
 * over so in-flight embeddings/queries abort with the connection.
 */
export function listRecentDocuments(
	dateFrom: string | undefined,
	dateTo: string | undefined,
	limit: number,
	db = getDatabase(),
): ListRecentDocumentsOutput {
	const parsedDateFrom = parseDateBound(dateFrom, "from");
	const parsedDateTo = parseDateBound(dateTo, "to");
	try {
		const filters: string[] = [];
		const params: number[] = [];
		if (parsedDateFrom !== undefined) {
			filters.push("COALESCE(published_at, created_at) >= ?");
			params.push(parsedDateFrom);
		}
		if (parsedDateTo !== undefined) {
			filters.push("COALESCE(published_at, created_at) <= ?");
			params.push(parsedDateTo);
		}
		params.push(limit);
		const rows = db
			.prepare(
				`SELECT id, title, filename, created_at, published_at, COALESCE(published_at, created_at) AS date
				 FROM documents
				 ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
				 ORDER BY date DESC, created_at DESC
				 LIMIT ?`,
			)
			.all(...params) as {
			id: string;
			title: string;
			filename: string;
			created_at: number;
			published_at: number | null;
			date: number;
		}[];
		return {
			ok: true,
			documents: rows.map((row) => ({
				id: row.id,
				title: row.title,
				filename: row.filename,
				createdAt: row.created_at,
				...(row.published_at !== null ? { publishedAt: row.published_at } : {}),
				date: row.date,
			})),
		};
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error ? error.message : "Could not list documents.",
			documents: [],
		};
	}
}

export function createKnowledgeTools(signal: AbortSignal): KnowledgeTools {
	return {
		searchKnowledge: tool({
			description:
				"Search the user's ingested knowledge base (documents they uploaded) " +
				"for passages relevant to a query. Uses hybrid retrieval — exact " +
				"keyword (full-text) matching fused with semantic vector search — so " +
				"both rare exact terms (codes, names) and paraphrased concepts are " +
				"found. Call this whenever the answer may depend on the user's own " +
				"documents. You may call it several times with refined queries to " +
				"gather enough context before answering. Cite the returned source " +
				"titles when you rely on them.",
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
				dateFrom: z
					.string()
					.optional()
					.describe(
						"Optional inclusive lower date bound as an ISO 8601 string. Filters by source publication date when available, otherwise ingest date.",
					),
				dateTo: z
					.string()
					.optional()
					.describe(
						"Optional inclusive upper date bound as an ISO 8601 string. Filters by source publication date when available, otherwise ingest date.",
					),
			}),
			execute: async ({
				query,
				topK,
				dateFrom,
				dateTo,
			}): Promise<SearchKnowledgeOutput> => {
				const parsedDateFrom = parseDateBound(dateFrom, "from");
				const parsedDateTo = parseDateBound(dateTo, "to");
				const retrieved = await retrieveChunks(query, {
					signal,
					topK: topK ?? 5,
					...(parsedDateFrom !== undefined ? { dateFrom: parsedDateFrom } : {}),
					...(parsedDateTo !== undefined ? { dateTo: parsedDateTo } : {}),
				});
				if (!retrieved.ok) {
					return { ok: false, error: retrieved.error, chunks: [] };
				}
				return { ok: true, chunks: retrieved.chunks };
			},
		}),
		listRecentDocuments: tool({
			description:
				"List documents in the user's brain by document date without semantic search. " +
				"Use this before summarizing recency, overview, or timeline-oriented brain activity. " +
				"Document date is source publication date when available, otherwise ingest date.",
			inputSchema: z.object({
				dateFrom: z
					.string()
					.optional()
					.describe(
						"Optional inclusive lower date bound as an ISO 8601 string.",
					),
				dateTo: z
					.string()
					.optional()
					.describe(
						"Optional inclusive upper date bound as an ISO 8601 string.",
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.describe("Maximum number of documents to list. Defaults to 20."),
			}),
			execute: async ({
				dateFrom,
				dateTo,
				limit,
			}): Promise<ListRecentDocumentsOutput> =>
				listRecentDocuments(dateFrom, dateTo, limit ?? 20),
		}),
	};
}
