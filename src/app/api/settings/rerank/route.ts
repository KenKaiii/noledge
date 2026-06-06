import { z } from "zod";
import { DEFAULT_RERANK_MODEL } from "@/lib/ai/rag/rerank";
import {
	deleteAppSetting,
	getAppSetting,
	setAppSetting,
} from "@/lib/ai/settings";

const bodySchema = z.object({
	enabled: z.boolean().optional(),
	// `null` clears the stored key; a non-empty string sets it.
	apiKey: z.string().trim().min(1).max(500).nullable().optional(),
	model: z.string().trim().min(1).max(200).nullable().optional(),
});

type RerankSettingsResponse = {
	enabled: boolean;
	hasKey: boolean;
	model: string;
};

function readRerankSettings(): RerankSettingsResponse {
	return {
		enabled: getAppSetting("rag.rerankEnabled") === "true",
		hasKey: getAppSetting("rag.rerankApiKey") !== null,
		model: getAppSetting("rag.rerankModel") ?? DEFAULT_RERANK_MODEL,
	};
}

export function GET(): Response {
	return Response.json(readRerankSettings());
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
			{ error: "Retrieval settings are invalid." },
			{ status: 400 },
		);
	}

	if (parsed.data.enabled !== undefined) {
		if (parsed.data.enabled) {
			setAppSetting("rag.rerankEnabled", "true");
		} else {
			deleteAppSetting("rag.rerankEnabled");
		}
	}

	if (parsed.data.apiKey === null) {
		deleteAppSetting("rag.rerankApiKey");
	} else if (parsed.data.apiKey !== undefined) {
		setAppSetting("rag.rerankApiKey", parsed.data.apiKey);
	}

	if (parsed.data.model === null) {
		deleteAppSetting("rag.rerankModel");
	} else if (parsed.data.model !== undefined) {
		setAppSetting("rag.rerankModel", parsed.data.model);
	}

	return Response.json(readRerankSettings());
}
