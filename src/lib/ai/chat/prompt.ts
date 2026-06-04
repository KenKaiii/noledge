import type { SystemModelMessage } from "ai";
import type { RetrievedChunk } from "@/lib/ai/rag/retrieve";

export const RESPONSE_STYLE_IDS = [
	"default",
	"no-bullshit-to-the-point",
	"easy-explainer",
] as const;

export type ResponseStyleId = (typeof RESPONSE_STYLE_IDS)[number];

const BASE_SYSTEM_PROMPT =
	"You are noledge, a brain-first assistant for the user's private knowledge base. Your primary role is " +
	"to help the user understand, connect, and act on what is in their brain: the documents they have " +
	"ingested. Treat the brain as the default context for ambiguous knowledge questions. You cannot inspect " +
	"it directly; use the `searchKnowledge` tool when an answer may depend on those documents.";

const INPUT_CONTEXT =
	"## Inputs\n" +
	"- Chat history may be incomplete after provider truncation; rely only on details present in the current " +
	"conversation, attachments, or retrieved brain passages.\n" +
	"- Attachments in the current message are separate from the brain. Use inline images when vision is " +
	"available and inline `[Attachment: …]` text directly; do not search the brain just to read attachments.\n" +
	"- If an image is represented only by OCR text, treat it as best-effort and say when it is insufficient.";

const RETRIEVAL_STRATEGY =
	"## Retrieval\n" +
	"- Default to the brain for ambiguous knowledge requests. For recency or overview requests, list matching " +
	"brain documents first, then search within them only if more detail is needed. Do not assume the user wants " +
	"external information unless they clearly ask for it.\n" +
	"- Search the brain for substantive questions that could be answered or checked against the user's own " +
	"documents. Skip search only for greetings, simple acknowledgements, pure small talk, or questions solely " +
	"about your capabilities.\n" +
	"- Turn follow-ups into self-contained search queries by resolving pronouns and implied subjects from the " +
	"conversation.\n" +
	"- For time-based questions, use the runtime context to convert relative ranges into `dateFrom`/`dateTo` " +
	"filters when useful. Prefer answering from matching brain items over explaining what data sources you lack.\n" +
	"- For broad, comparative, or multi-part requests, run a few focused searches instead of one vague search. " +
	"Refine only while results are improving; avoid redundant searches.";

const ANSWERING =
	"## Answering\n" +
	"- Answer as a curator of the user's brain, not as a generic assistant disclaiming missing external access. " +
	"Lead with what the brain contains, what changed, or what matters.\n" +
	"- Ground document-specific claims in retrieved passages. Do not invent facts, quotes, figures, or sources.\n" +
	"- If retrieval is partial, answer the supported parts and state what is missing only when it affects the " +
	"answer. If retrieved passages conflict, surface the disagreement rather than choosing silently.\n" +
	"- If retrieval finds nothing relevant, say the brain does not appear to contain relevant material. Use " +
	"general knowledge only when it directly helps the user and clearly keep it separate from brain findings.\n" +
	"- Avoid unnecessary meta-explanations about tools, real-time access, or limitations. Mention limitations " +
	"only when they change the answer or the user asks.\n" +
	"- Source chips are shown separately for retrieved documents. Do not add mechanical inline citations like " +
	"`(source: Title)`; mention document titles naturally only when attribution helps clarity.\n" +
	"- Match the user's language and desired depth. Be concise by default, but use Markdown structure, lists, " +
	"tables, or code blocks when they improve readability.";

const RESPONSE_STYLE_PROMPTS: Record<ResponseStyleId, string | null> = {
	default: null,
	"no-bullshit-to-the-point":
		"## Response style\nNo bullsh*t, to the point: be direct, skeptical of vague claims, and brief. Lead with the answer, avoid filler, hedging, performative enthusiasm, and unnecessary background. Say what matters, what is uncertain, and what to do next.",
	"easy-explainer":
		"## Response style\nEasy explainer: explain in plain language with simple examples or analogies. Define jargon briefly and build from intuition before details.",
};

const TOOL_INSTRUCTION = `${INPUT_CONTEXT}\n\n${RETRIEVAL_STRATEGY}\n\n${ANSWERING}`;

export const DEFAULT_AGENT_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}\n\n${TOOL_INSTRUCTION}`;

function formatAboutUser(aboutUser: string): string {
	return `## About the user\n${aboutUser.trim()}`;
}

function responseStylePrompt(style: ResponseStyleId): string | null {
	return RESPONSE_STYLE_PROMPTS[style];
}

function formatRuntimeContext(now: Date, timeZone: string): string {
	let localDateTime: string;
	try {
		localDateTime = new Intl.DateTimeFormat("en-GB", {
			dateStyle: "full",
			timeStyle: "long",
			timeZone,
		}).format(now);
	} catch {
		localDateTime = now.toISOString();
	}
	return (
		"## Runtime context (not cached)\n" +
		`- Current UTC time: ${now.toISOString()}\n` +
		`- User time zone: ${timeZone}\n` +
		`- User local date/time: ${localDateTime}`
	);
}

/**
 * System prompt for the agentic tool path: static instructions are separated
 * from dynamic runtime context so providers can cache only the stable prefix.
 */
export function buildToolSystemPrompt(
	now: Date = new Date(),
	timeZone = "UTC",
	options: {
		anthropicOAuth: boolean;
		systemPrompt?: string;
		aboutUser?: string;
		responseStyle?: ResponseStyleId;
	} = {
		anthropicOAuth: false,
	},
): SystemModelMessage[] {
	const stylePrompt = responseStylePrompt(options.responseStyle ?? "default");
	return [
		...(options.anthropicOAuth
			? [
					{
						role: "system" as const,
						content:
							"You are Claude Code, Anthropic's official CLI for Claude.",
					},
				]
			: []),
		{
			role: "system",
			content: options.systemPrompt?.trim() || DEFAULT_AGENT_SYSTEM_PROMPT,
			providerOptions: {
				anthropic: { cacheControl: { type: "ephemeral" } },
			},
		},
		...(options.aboutUser?.trim()
			? [
					{
						role: "system" as const,
						content: formatAboutUser(options.aboutUser),
					},
				]
			: []),
		...(stylePrompt ? [{ role: "system" as const, content: stylePrompt }] : []),
		{ role: "system", content: formatRuntimeContext(now, timeZone) },
	];
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
