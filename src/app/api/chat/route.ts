import { type ModelMessage, streamText } from "ai";
import { z } from "zod";
import { buildSystemPrompt, toSources } from "@/lib/ai/chat/prompt";
import { type ChatStreamChunk, encodeChunk } from "@/lib/ai/chat/sse";
import { resolveModel } from "@/lib/ai/models/registry";
import { type RetrievedChunk, retrieveChunks } from "@/lib/ai/rag/retrieve";

const textPartSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
});

const messageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "system"]),
	parts: z.array(textPartSchema),
});

const bodySchema = z.object({
	messages: z.array(messageSchema).min(1),
	model: z.string().optional(),
	useRag: z.boolean().optional().default(true),
});

function partsToText(parts: { text: string }[]): string {
	return parts
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function lastUserText(
	messages: z.infer<typeof bodySchema>["messages"],
): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === "user") return partsToText(message.parts);
	}
	return "";
}

function toModelMessages(
	messages: z.infer<typeof bodySchema>["messages"],
): ModelMessage[] {
	return messages.map((message) => ({
		role: message.role,
		content: partsToText(message.parts),
	}));
}

function errorStream(message: string): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encodeChunk({ type: "text", text: message }));
			controller.enqueue(encodeChunk({ type: "done" }));
			controller.close();
		},
	});
}

export async function POST(request: Request): Promise<Response> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return Response.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			{ status: 400 },
		);
	}

	const { messages, model, useRag } = parsed.data;

	const resolved = resolveModel(model);
	if (!resolved.ok) {
		return new Response(errorStream(resolved.error), {
			headers: sseHeaders(),
		});
	}

	const query = lastUserText(messages);
	const sources: CollectedSources =
		useRag && query.length > 0
			? await collectSources(query, request.signal)
			: { chunks: [], sourceChips: [] };

	const system = buildSystemPrompt(sources.chunks);

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const aborted = (): boolean => request.signal.aborted;
			try {
				for (const source of sources.sourceChips) {
					controller.enqueue(encodeChunk({ type: "source", source }));
				}

				const result = streamText({
					model: resolved.model,
					system,
					messages: toModelMessages(messages),
					abortSignal: request.signal,
				});

				for await (const delta of result.textStream) {
					if (aborted()) break;
					controller.enqueue(encodeChunk({ type: "text", text: delta }));
				}

				controller.enqueue(
					encodeChunk({ type: "done" } satisfies ChatStreamChunk),
				);
			} catch (error) {
				if (!aborted()) {
					controller.enqueue(
						encodeChunk({
							type: "text",
							text:
								error instanceof Error
									? `Something went wrong: ${error.message}`
									: "Something went wrong while generating a response.",
						}),
					);
					controller.enqueue(encodeChunk({ type: "done" }));
				}
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, { headers: sseHeaders() });
}

type CollectedSources = {
	chunks: RetrievedChunk[];
	sourceChips: ReturnType<typeof toSources>;
};

async function collectSources(
	query: string,
	signal: AbortSignal,
): Promise<CollectedSources> {
	const retrieved = await retrieveChunks(query, { signal, topK: 5 });
	if (!retrieved.ok) return { chunks: [], sourceChips: [] };
	return { chunks: retrieved.chunks, sourceChips: toSources(retrieved.chunks) };
}

function sseHeaders(): HeadersInit {
	return {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
	};
}
