import { z } from "zod";
import {
	DEFAULT_AGENT_SYSTEM_PROMPT,
	RESPONSE_STYLE_IDS,
	type ResponseStyleId,
} from "@/lib/ai/chat/prompt";
import {
	deleteAppSetting,
	getAppSetting,
	setAppSetting,
} from "@/lib/ai/settings";

const legacyResponseStyleSchema = z.union([
	z.enum(RESPONSE_STYLE_IDS),
	z.literal("no-bullshit"),
	z.literal("to-the-point"),
]);

const bodySchema = z.object({
	systemPrompt: z.string().trim().min(1).max(20_000).nullable().optional(),
	aboutUser: z.string().trim().max(5_000).nullable().optional(),
	responseStyle: legacyResponseStyleSchema.optional(),
});

type AgentSettingsResponse = {
	systemPrompt: string;
	defaultSystemPrompt: string;
	aboutUser: string;
	responseStyle: ResponseStyleId;
	customized: boolean;
};

function normalizeResponseStyle(
	value: string | null | undefined,
): ResponseStyleId {
	if (value === "no-bullshit" || value === "to-the-point") {
		return "no-bullshit-to-the-point";
	}
	return RESPONSE_STYLE_IDS.includes(value as ResponseStyleId)
		? (value as ResponseStyleId)
		: "default";
}

function readAgentSettings(): AgentSettingsResponse {
	const systemPrompt = getAppSetting("agent.systemPrompt");
	const responseStyle = getAppSetting("agent.responseStyle");
	return {
		systemPrompt: systemPrompt ?? DEFAULT_AGENT_SYSTEM_PROMPT,
		defaultSystemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
		aboutUser: getAppSetting("agent.aboutUser") ?? "",
		responseStyle: normalizeResponseStyle(responseStyle),
		customized: systemPrompt !== null,
	};
}

export function GET(): Response {
	return Response.json(readAgentSettings());
}

export async function PUT(request: Request): Promise<Response> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return Response.json(
			{ error: "Agent settings are invalid." },
			{ status: 400 },
		);
	}

	if (parsed.data.systemPrompt === null) {
		deleteAppSetting("agent.systemPrompt");
	} else if (parsed.data.systemPrompt !== undefined) {
		setAppSetting("agent.systemPrompt", parsed.data.systemPrompt);
	}

	if (parsed.data.aboutUser === null || parsed.data.aboutUser === "") {
		deleteAppSetting("agent.aboutUser");
	} else if (parsed.data.aboutUser !== undefined) {
		setAppSetting("agent.aboutUser", parsed.data.aboutUser);
	}

	if (parsed.data.responseStyle !== undefined) {
		const responseStyle = normalizeResponseStyle(parsed.data.responseStyle);
		if (responseStyle === "default") {
			deleteAppSetting("agent.responseStyle");
		} else {
			setAppSetting("agent.responseStyle", responseStyle);
		}
	}

	return Response.json(readAgentSettings());
}
