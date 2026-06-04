import { stepCountIs, streamText } from "ai";
import { z } from "zod";
import { buildModelMessages } from "@/lib/ai/chat/attachments";
import {
	buildToolSystemPrompt,
	RESPONSE_STYLE_IDS,
	type ResponseStyleId,
	toSources,
} from "@/lib/ai/chat/prompt";
import { type ChatStreamChunk, encodeChunk } from "@/lib/ai/chat/sse";
import { createKnowledgeTools, type RecentDocument } from "@/lib/ai/chat/tools";
import { refreshExpiredOAuthCredentials } from "@/lib/ai/models/oauth";
import { resolveModel } from "@/lib/ai/models/registry";
import { getAppSetting } from "@/lib/ai/settings";

const textPartSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
});

const filePartSchema = z.object({
	type: z.literal("file"),
	name: z.string(),
	mediaType: z.string(),
	data: z.string(),
});

const partSchema = z.discriminatedUnion("type", [
	textPartSchema,
	filePartSchema,
]);

const messageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "system"]),
	parts: z.array(partSchema),
});

const bodySchema = z.object({
	messages: z.array(messageSchema).min(1),
	model: z.string().optional(),
	useRag: z.boolean().optional().default(true),
	/** Enable the model's reasoning/thinking trace (only affects capable models). */
	thinking: z.boolean().optional().default(true),
	/** Browser IANA time zone used for dynamic date instructions. */
	timeZone: z.string().min(1).optional().default("UTC"),
});

function errorStream(message: string): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encodeChunk({ type: "text", text: message }));
			controller.enqueue(encodeChunk({ type: "done" }));
			controller.close();
		},
	});
}

function recentDocumentSource(document: RecentDocument): {
	id: string;
	href: string;
	title: string;
	description: string;
} {
	const date = new Date(document.date).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
	return {
		id: document.id,
		href: "/knowledge",
		title: document.title,
		description: document.publishedAt
			? `Published ${date}`
			: `Ingested ${date}`,
	};
}

function errorMessage(error: unknown): string {
	if (!(error instanceof Error)) {
		return "Something went wrong while generating a response.";
	}

	const message = error.message;
	const normalized = message.toLowerCase();
	if (
		normalized.includes("rate limit") ||
		normalized.includes("quota") ||
		normalized.includes("usage limit")
	) {
		return `Provider usage/rate limit reached: ${message}`;
	}

	return `Something went wrong: ${message}`;
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

	const { messages, model, useRag, thinking, timeZone } = parsed.data;

	await refreshExpiredOAuthCredentials();
	const resolved = resolveModel(model, { thinking });
	if (!resolved.ok) {
		return new Response(errorStream(resolved.error), {
			headers: sseHeaders(),
		});
	}

	const modelMessages = await buildModelMessages(messages, {
		supportsVision: resolved.supportsVision,
		signal: request.signal,
	});

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const aborted = (): boolean => request.signal.aborted;
			const emittedSources = new Set<string>();
			// The model can emit text across multiple steps (e.g. a sentence before a
			// tool call, then the real answer after the tool result). Those segments
			// stream as separate `text-delta` parts and would otherwise be concatenated
			// with no separation ("…searches.I can't see…"). Track segment boundaries
			// so we can insert a paragraph break between them.
			let emittedText = false;
			let separatorPending = false;
			// Reasoning streams as its own sequence of deltas; accumulate the same way
			// and break between distinct reasoning segments (one per step).
			let emittedReasoning = false;
			let reasoningSeparatorPending = false;
			try {
				const agentSystemPrompt = getAppSetting("agent.systemPrompt");
				const aboutUser = getAppSetting("agent.aboutUser");
				const responseStyle = getAppSetting("agent.responseStyle");
				const style =
					responseStyle === "no-bullshit" || responseStyle === "to-the-point"
						? "no-bullshit-to-the-point"
						: RESPONSE_STYLE_IDS.includes(responseStyle as ResponseStyleId)
							? (responseStyle as ResponseStyleId)
							: "default";
				const result = streamText({
					model: resolved.model,
					system: buildToolSystemPrompt(new Date(), timeZone, {
						anthropicOAuth:
							resolved.provider === "anthropic" &&
							resolved.credentialSource === "oauth",
						...(agentSystemPrompt ? { systemPrompt: agentSystemPrompt } : {}),
						...(aboutUser ? { aboutUser } : {}),
						responseStyle: style,
					}),
					messages: modelMessages,
					tools: createKnowledgeTools(request.signal),
					providerOptions: resolved.providerOptions,
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
					if (part.type === "reasoning-start") {
						if (emittedReasoning) reasoningSeparatorPending = true;
						continue;
					}
					if (part.type === "reasoning-delta") {
						if (part.text.length === 0) continue;
						const text = reasoningSeparatorPending
							? `\n\n${part.text}`
							: part.text;
						reasoningSeparatorPending = false;
						emittedReasoning = true;
						controller.enqueue(encodeChunk({ type: "reasoning", text }));
						continue;
					}
					if (part.type === "text-start") {
						if (emittedText) separatorPending = true;
						continue;
					}
					if (part.type === "text-delta") {
						if (part.text.length === 0) continue;
						const text = separatorPending ? `\n\n${part.text}` : part.text;
						separatorPending = false;
						emittedText = true;
						controller.enqueue(encodeChunk({ type: "text", text }));
						continue;
					}
					if (part.type === "tool-result" && !part.dynamic) {
						if (part.toolName === "searchKnowledge" && part.output.ok) {
							for (const source of toSources(part.output.chunks)) {
								if (emittedSources.has(source.id)) continue;
								emittedSources.add(source.id);
								controller.enqueue(encodeChunk({ type: "source", source }));
							}
							continue;
						}
						if (part.toolName === "listRecentDocuments" && part.output.ok) {
							for (const document of part.output.documents) {
								if (emittedSources.has(document.id)) continue;
								emittedSources.add(document.id);
								controller.enqueue(
									encodeChunk({
										type: "source",
										source: recentDocumentSource(document),
									}),
								);
							}
							continue;
						}
					}
					if (part.type === "tool-error") {
						controller.enqueue(
							encodeChunk({ type: "text", text: errorMessage(part.error) }),
						);
						break;
					}
					if (part.type === "error") {
						controller.enqueue(
							encodeChunk({ type: "text", text: errorMessage(part.error) }),
						);
						break;
					}
					if (part.type === "finish-step" && part.finishReason === "length") {
						controller.enqueue(
							encodeChunk({
								type: "text",
								text: emittedText
									? "\n\nThe model hit its output limit before finishing. Try asking for fewer sources or a narrower time window."
									: "The model hit its output limit before it could answer. Try asking for fewer sources or a narrower time window.",
							}),
						);
						break;
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
							text: errorMessage(error),
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
