"use client";

import { Settings } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ChatContainerContent,
	ChatContainerRoot,
} from "@/components/prompt-kit/chat-container";
import { ScrollButton } from "@/components/prompt-kit/scroll-button";
import { Button } from "@/components/ui/button";
import type {
	ChatMessage as ApiMessage,
	ChatStreamChunk,
} from "@/lib/ai/chat/sse";
import { ChatInputBar } from "./chat-input-bar";
import { ChatMessage } from "./chat-message";
import type { Attachment, ChatStatus, UiMessage } from "./types";

function createId(): string {
	return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toApiMessages(messages: UiMessage[]): ApiMessage[] {
	return messages.map((message) => ({
		id: message.id,
		role: message.role,
		parts: [{ type: "text", text: message.content }],
	}));
}

function makeTitle(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= 60) return trimmed;
	return `${trimmed.slice(0, 57)}…`;
}

type Conversation = {
	id: string;
	title: string;
	messages: { role: "user" | "assistant"; content: string }[];
};

export function Chat(): React.JSX.Element {
	const searchParams = useSearchParams();
	const chatIdFromUrl = searchParams.get("chat");
	const router = useRouter();

	const [messages, setMessages] = useState<UiMessage[]>([]);
	const [input, setInput] = useState("");
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [model, setModel] = useState<string | null>(() => {
		if (typeof window === "undefined") return null;
		try {
			return window.localStorage.getItem("noledge-model");
		} catch {
			return null;
		}
	});
	const [hasModels, setHasModels] = useState<boolean | null>(null);
	const [loadingConversation, setLoadingConversation] = useState(
		Boolean(chatIdFromUrl),
	);
	const [loadError, setLoadError] = useState<string | null>(null);

	const abortRef = useRef<AbortController | null>(null);
	const modelRef = useRef<string | null>(null);
	modelRef.current = model;

	const conversationIdRef = useRef<string | null>(null);
	const loadedChatIdRef = useRef<string | null>(null);
	const messagesRef = useRef<UiMessage[]>([]);
	messagesRef.current = messages;

	// Persist model selection
	useEffect(() => {
		if (model) {
			try {
				window.localStorage.setItem("noledge-model", model);
			} catch {
				/* ignore storage errors */
			}
		}
	}, [model]);

	// Load conversation from URL
	useEffect(() => {
		if (!chatIdFromUrl) {
			setMessages([]);
			conversationIdRef.current = null;
			loadedChatIdRef.current = null;
			setLoadingConversation(false);
			setLoadError(null);
			return;
		}
		if (loadedChatIdRef.current === chatIdFromUrl) {
			setLoadingConversation(false);
			return;
		}
		setLoadingConversation(true);
		setLoadError(null);
		fetch(`/api/conversations/${chatIdFromUrl}`)
			.then((res) => {
				if (!res.ok) throw new Error("Failed to load conversation");
				return res.json() as Promise<{ conversation: Conversation }>;
			})
			.then((data) => {
				const loaded = data.conversation.messages.map((m, i) => ({
					id: `m-${chatIdFromUrl}-${i}`,
					role: m.role,
					content: m.content,
				}));
				setMessages(loaded);
				conversationIdRef.current = data.conversation.id;
				loadedChatIdRef.current = chatIdFromUrl;
			})
			.catch(() => {
				setLoadError("Could not load this conversation.");
			})
			.finally(() => {
				setLoadingConversation(false);
			});
	}, [chatIdFromUrl]);

	useEffect(() => {
		let active = true;
		fetch("/api/models")
			.then((res) => res.json())
			.then((data: { models: unknown[] }) => {
				if (active) setHasModels(data.models.length > 0);
			})
			.catch(() => {
				if (active) setHasModels(false);
			});
		return () => {
			active = false;
		};
	}, []);

	const saveConversation = useCallback(
		async (id: string | null, msgs: UiMessage[]): Promise<string | null> => {
			const payload = msgs.map((m) => ({
				role: m.role,
				content: m.content,
			}));

			if (!id) {
				const firstUser = msgs.find((m) => m.role === "user");
				const title = firstUser ? makeTitle(firstUser.content) : "New chat";
				const res = await fetch("/api/conversations", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title, messages: payload }),
				});
				if (!res.ok) return null;
				const data = (await res.json()) as { id: string };
				const newId = data.id;
				conversationIdRef.current = newId;
				loadedChatIdRef.current = newId;
				router.replace(`/?chat=${newId}`);
				return newId;
			}

			const res = await fetch(`/api/conversations/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ messages: payload }),
			});
			if (!res.ok) return null;
			return id;
		},
		[router],
	);

	const updateAssistant = useCallback(
		(id: string, patch: (prev: UiMessage) => UiMessage): void => {
			setMessages((prev) =>
				prev.map((message) => (message.id === id ? patch(message) : message)),
			);
		},
		[],
	);

	const runStream = useCallback(
		async (history: UiMessage[]): Promise<void> => {
			const assistantId = createId();
			setMessages((prev) => [
				...prev,
				{ id: assistantId, role: "assistant", content: "" },
			]);
			setStatus("submitting");

			const controller = new AbortController();
			abortRef.current = controller;

			// Throttle text rendering: tokens arrive far faster than the UI needs to
			// repaint. We buffer deltas and flush the accumulated text on a ~50ms
			// cadence so React re-renders (and the markdown re-lex) stay bounded
			// regardless of token rate.
			let pendingText = "";
			let flushTimer: ReturnType<typeof setTimeout> | null = null;

			const flushText = (): void => {
				flushTimer = null;
				if (!pendingText) return;
				const delta = pendingText;
				pendingText = "";
				updateAssistant(assistantId, (prev) => ({
					...prev,
					content: prev.content + delta,
				}));
			};

			const scheduleFlush = (): void => {
				if (flushTimer === null) flushTimer = setTimeout(flushText, 50);
			};

			try {
				const response = await fetch("/api/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						messages: toApiMessages(history),
						model: modelRef.current ?? undefined,
					}),
					signal: controller.signal,
				});

				if (!response.body) throw new Error("No response body");

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });

					const events = buffer.split("\n\n");
					buffer = events.pop() ?? "";

					for (const event of events) {
						const line = event.trim();
						if (!line.startsWith("data:")) continue;
						const json = line.slice(5).trim();
						if (!json) continue;
						const chunk = JSON.parse(json) as ChatStreamChunk;

						if (chunk.type === "text") {
							setStatus("streaming");
							pendingText += chunk.text;
							scheduleFlush();
						} else if (chunk.type === "reasoning") {
							updateAssistant(assistantId, (prev) => ({
								...prev,
								reasoning: chunk.text,
							}));
						} else if (chunk.type === "step") {
							updateAssistant(assistantId, (prev) => ({
								...prev,
								steps: [...(prev.steps ?? []), chunk.step],
							}));
						} else if (chunk.type === "source") {
							updateAssistant(assistantId, (prev) => ({
								...prev,
								sources: [...(prev.sources ?? []), chunk.source],
							}));
						} else if (chunk.type === "image") {
							updateAssistant(assistantId, (prev) => ({
								...prev,
								image: { url: chunk.url, alt: chunk.alt },
							}));
						}
					}
				}
				// Flush any buffered tail so no trailing tokens are dropped.
				if (flushTimer !== null) clearTimeout(flushTimer);
				flushText();
			} catch (error) {
				if (flushTimer !== null) clearTimeout(flushTimer);
				flushText();
				if (!(error instanceof DOMException && error.name === "AbortError")) {
					updateAssistant(assistantId, (prev) => ({
						...prev,
						content:
							prev.content ||
							"Something went wrong while generating a response.",
					}));
				}
			} finally {
				abortRef.current = null;
				setStatus("ready");
			}
		},
		[updateAssistant],
	);

	// Auto-save conversation after each assistant response finishes
	useEffect(() => {
		if (status !== "ready" || messagesRef.current.length === 0) return;
		const id = conversationIdRef.current;
		void saveConversation(id, messagesRef.current).then((savedId) => {
			if (savedId) {
				conversationIdRef.current = savedId;
				window.dispatchEvent(new CustomEvent("conversations:changed"));
			}
		});
	}, [status, saveConversation]);

	const sendMessage = useCallback((): void => {
		const text = input.trim();
		if ((text.length === 0 && attachments.length === 0) || status !== "ready") {
			return;
		}

		const userMessage: UiMessage = {
			id: createId(),
			role: "user",
			content: text,
			attachments: attachments.length > 0 ? attachments : undefined,
		};

		const history = [...messages, userMessage];
		setMessages(history);
		setInput("");
		setAttachments([]);
		void runStream(history);
	}, [attachments, input, messages, runStream, status]);

	const stop = useCallback((): void => {
		abortRef.current?.abort();
	}, []);

	const regenerate = useCallback((): void => {
		if (status !== "ready") return;
		let lastUserIndex = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i]?.role === "user") {
				lastUserIndex = i;
				break;
			}
		}
		if (lastUserIndex === -1) return;
		const history = messages.slice(0, lastUserIndex + 1);
		setMessages(history);
		void runStream(history);
	}, [messages, runStream, status]);

	const onFilesAdded = useCallback((files: File[]): void => {
		const next = files.map((file) => ({
			id: createId(),
			name: file.name,
			type: file.type,
			url: URL.createObjectURL(file),
		}));
		setAttachments((prev) => [...prev, ...next]);
	}, []);

	const removeAttachment = useCallback((id: string): void => {
		setAttachments((prev) => {
			const target = prev.find((attachment) => attachment.id === id);
			if (target) URL.revokeObjectURL(target.url);
			return prev.filter((attachment) => attachment.id !== id);
		});
	}, []);

	if (loadingConversation) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">Loading conversation…</p>
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-4">
				<p className="text-sm text-muted-foreground">{loadError}</p>
				<Button variant="outline" size="sm" asChild>
					<a href="/">Start a new chat</a>
				</Button>
			</div>
		);
	}

	const isEmpty = messages.length === 0;

	if (isEmpty) {
		const noProviders = hasModels === false;
		return (
			<div className="flex h-full flex-col items-center justify-center px-4">
				<div className="w-full max-w-2xl space-y-6">
					{noProviders ? (
						<div className="flex flex-col items-center gap-4 text-center">
							<h1 className="text-2xl font-semibold tracking-tight">
								No providers connected
							</h1>
							<p className="text-sm text-muted-foreground">
								Add an API key in Settings to start chatting.
							</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									document
										.querySelector<HTMLButtonElement>("[data-settings-trigger]")
										?.click();
								}}
							>
								<Settings className="size-4" />
								Open Settings
							</Button>
						</div>
					) : (
						<>
							<h1 className="text-center text-3xl font-semibold tracking-tight">
								What can I help with?
							</h1>
							<ChatInputBar
								value={input}
								onValueChange={setInput}
								onSubmit={sendMessage}
								onStop={stop}
								status={status}
								attachments={attachments}
								onFilesAdded={onFilesAdded}
								onRemoveAttachment={removeAttachment}
								model={model}
								onModelChange={setModel}
							/>
						</>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<ChatContainerRoot className="relative flex-1">
				<ChatContainerContent className="mx-auto w-full max-w-3xl gap-8 px-4 py-8">
					{messages.map((message, index) => (
						<ChatMessage
							key={message.id}
							message={message}
							isLast={index === messages.length - 1}
							status={status}
							onRegenerate={regenerate}
						/>
					))}
				</ChatContainerContent>
				<div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
					<div className="pointer-events-auto">
						<ScrollButton />
					</div>
				</div>
			</ChatContainerRoot>

			<div className="mx-auto w-full max-w-3xl px-4 pb-4">
				<ChatInputBar
					value={input}
					onValueChange={setInput}
					onSubmit={sendMessage}
					onStop={stop}
					status={status}
					attachments={attachments}
					onFilesAdded={onFilesAdded}
					onRemoveAttachment={removeAttachment}
					model={model}
					onModelChange={setModel}
				/>
			</div>
		</div>
	);
}
