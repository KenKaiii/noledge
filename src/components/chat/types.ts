import type { ChatReasoningStep, ChatSource } from "@/lib/ai/chat/sse";

export type ChatStatus = "ready" | "submitting" | "streaming";

export type Attachment = {
	id: string;
	name: string;
	type: string;
	url: string;
};

export type AssistantImage = {
	url: string;
	alt: string;
};

export type UiMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	attachments?: Attachment[];
	reasoning?: string;
	steps?: ChatReasoningStep[];
	sources?: ChatSource[];
	image?: AssistantImage;
};
