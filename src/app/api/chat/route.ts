import { type ModelMessage, stepCountIs, streamText } from "ai";
import { z } from "zod";
import { buildToolSystemPrompt, toSources } from "@/lib/ai/chat/prompt";
import { type ChatStreamChunk, encodeChunk } from "@/lib/ai/chat/sse";
import { createKnowledgeTools } from "@/lib/ai/chat/tools";
import { resolveModel } from "@/lib/ai/models/registry";

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

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const aborted = (): boolean => request.signal.aborted;
			const emittedSources = new Set<string>();
			try {
				const result = streamText({
					model: resolved.model,
					system: buildToolSystemPrompt(),
					messages: toModelMessages(messages),
					tools: createKnowledgeTools(request.signal),
					// Grounding is enforced via the system prompt (always search before
					// answering). We keep tool choice on "auto" rather than forcing a tool
					// call, because reasoning models reject a forced tool_choice while
					// thinking is enabled.
					toolChoice: useRag ? "auto" : "none",
					stopWhen: stepCountIs(6),
					abortSignal: request.signal,
				});

				for await (const part of result.fullStream) {
					if (aborted()) break;
					if (part.type === "text-delta") {
						controller.enqueue(encodeChunk({ type: "text", text: part.text }));
						continue;
					}
					if (
						part.type === "tool-result" &&
						!part.dynamic &&
						part.toolName === "searchKnowledge" &&
						part.output.ok
					) {
						for (const source of toSources(part.output.chunks)) {
							if (emittedSources.has(source.id)) continue;
							emittedSources.add(source.id);
							controller.enqueue(encodeChunk({ type: "source", source }));
						}
					}
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

function sseHeaders(): HeadersInit {
	return {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
	};
}
