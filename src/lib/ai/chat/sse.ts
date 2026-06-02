/**
 * Chat streaming protocol. These types and the SSE encoder are shared between the
 * chat route and the client reader in `chat.tsx`. The wire format is a custom SSE
 * stream of `ChatStreamChunk` JSON events (`data: {...}\n\n`).
 */

export type ChatRole = "user" | "assistant" | "system";

export type ChatTextPart = {
	type: "text";
	text: string;
};

export type ChatMessage = {
	id: string;
	role: ChatRole;
	parts: ChatTextPart[];
};

export type ChatSource = {
	id: string;
	href: string;
	title: string;
	description: string;
};

export type ChatReasoningStep = {
	id: string;
	label: string;
	detail: string;
};

/** Server-Sent event payloads streamed to the client. */
export type ChatStreamChunk =
	| { type: "reasoning"; text: string }
	| { type: "step"; step: ChatReasoningStep }
	| { type: "text"; text: string }
	| { type: "source"; source: ChatSource }
	| { type: "image"; url: string; alt: string }
	| { type: "done" };

const encoder = new TextEncoder();

/** Encode a chunk as a single SSE `data:` event frame. */
export function encodeChunk(chunk: ChatStreamChunk): Uint8Array {
	return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}
