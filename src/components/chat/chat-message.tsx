"use client";

import {
	Check,
	Copy,
	FileText,
	RefreshCcw,
	ThumbsDown,
	ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import {
	ChainOfThought,
	ChainOfThoughtContent,
	ChainOfThoughtItem,
	ChainOfThoughtStep,
	ChainOfThoughtTrigger,
} from "@/components/prompt-kit/chain-of-thought";
import { Markdown } from "@/components/prompt-kit/markdown";
import {
	Message,
	MessageAction,
	MessageActions,
} from "@/components/prompt-kit/message";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/prompt-kit/reasoning";
import {
	Source,
	SourceContent,
	SourceTrigger,
} from "@/components/prompt-kit/source";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatStatus, UiMessage } from "./types";

type ChatMessageProps = {
	message: UiMessage;
	isLast: boolean;
	status: ChatStatus;
	onRegenerate: () => void;
};

export function ChatMessage({
	message,
	isLast,
	status,
	onRegenerate,
}: ChatMessageProps): React.JSX.Element {
	if (message.role === "user") {
		return <UserMessage message={message} />;
	}
	return (
		<AssistantMessage
			message={message}
			isLast={isLast}
			status={status}
			onRegenerate={onRegenerate}
		/>
	);
}

function UserMessage({ message }: { message: UiMessage }): React.JSX.Element {
	return (
		<Message className="animate-message-in flex-col items-end gap-2">
			{message.attachments && message.attachments.length > 0 ? (
				<div className="flex flex-wrap justify-end gap-2">
					{message.attachments.map((attachment) =>
						attachment.type.startsWith("image/") ? (
							// biome-ignore lint/performance/noImgElement: local object URLs, not optimizable
							<img
								key={attachment.id}
								src={attachment.url}
								alt={attachment.name}
								className="size-20 rounded-lg border object-cover"
							/>
						) : (
							<div
								key={attachment.id}
								className="flex items-center gap-2 rounded-lg border bg-secondary px-3 py-2 text-sm"
							>
								<FileText className="size-4 shrink-0" />
								<span className="max-w-40 truncate">{attachment.name}</span>
							</div>
						),
					)}
				</div>
			) : null}
			{message.content ? (
				<div className="max-w-[80%] rounded-3xl bg-secondary px-4 py-2.5 text-foreground">
					{message.content}
				</div>
			) : null}
		</Message>
	);
}

function AssistantMessage({
	message,
	isLast,
	status,
	onRegenerate,
}: {
	message: UiMessage;
	isLast: boolean;
	status: ChatStatus;
	onRegenerate: () => void;
}): React.JSX.Element {
	const [copied, setCopied] = useState(false);
	const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
	const isStreaming = isLast && status === "streaming";
	const isWaiting = isLast && status === "submitting";

	const copy = async (): Promise<void> => {
		await navigator.clipboard.writeText(message.content);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<Message className="animate-message-in flex-col items-start gap-3">
			{message.reasoning ? (
				<Reasoning isStreaming={isStreaming} className="w-full">
					<ReasoningTrigger className="text-sm text-muted-foreground">
						Reasoning
					</ReasoningTrigger>
					<ReasoningContent
						markdown
						className="mt-2 border-l-2 border-border pl-4"
					>
						{message.reasoning}
					</ReasoningContent>
				</Reasoning>
			) : null}

			{message.steps && message.steps.length > 0 ? (
				<ChainOfThought className="w-full">
					{message.steps.map((step) => (
						<ChainOfThoughtStep key={step.id}>
							<ChainOfThoughtTrigger>{step.label}</ChainOfThoughtTrigger>
							<ChainOfThoughtContent>
								<ChainOfThoughtItem>{step.detail}</ChainOfThoughtItem>
							</ChainOfThoughtContent>
						</ChainOfThoughtStep>
					))}
				</ChainOfThought>
			) : null}

			{isWaiting && !message.content ? (
				<TextShimmer className="text-sm">Thinking…</TextShimmer>
			) : (
				<Markdown className="prose w-full max-w-full break-words dark:prose-invert">
					{message.content}
				</Markdown>
			)}

			{message.image ? (
				// biome-ignore lint/performance/noImgElement: remote demo image
				<img
					src={message.image.url}
					alt={message.image.alt}
					className="mt-1 max-h-80 w-auto rounded-xl border object-cover"
				/>
			) : null}

			{message.sources && message.sources.length > 0 ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-muted-foreground">Sources</span>
					{message.sources.map((source) => (
						<Source key={source.id} href={source.href}>
							<SourceTrigger label={source.title} />
							<SourceContent
								title={source.title}
								description={source.description}
							/>
						</Source>
					))}
				</div>
			) : null}

			{!isStreaming && !isWaiting && message.content ? (
				<MessageActions
					className={cn("mt-1", isLast ? "opacity-100" : "opacity-70")}
				>
					<MessageAction tooltip={copied ? "Copied" : "Copy"}>
						<Button variant="ghost" size="icon" onClick={copy}>
							{copied ? (
								<Check className="size-4" />
							) : (
								<Copy className="size-4" />
							)}
						</Button>
					</MessageAction>
					<MessageAction tooltip="Regenerate">
						<Button variant="ghost" size="icon" onClick={onRegenerate}>
							<RefreshCcw className="size-4" />
						</Button>
					</MessageAction>
					<MessageAction tooltip="Good response">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setFeedback("up")}
						>
							<ThumbsUp
								className={cn("size-4", feedback === "up" && "text-foreground")}
							/>
						</Button>
					</MessageAction>
					<MessageAction tooltip="Bad response">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setFeedback("down")}
						>
							<ThumbsDown
								className={cn(
									"size-4",
									feedback === "down" && "text-foreground",
								)}
							/>
						</Button>
					</MessageAction>
				</MessageActions>
			) : null}
		</Message>
	);
}
