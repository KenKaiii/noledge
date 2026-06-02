import { availableModels, defaultModelId } from "@/lib/ai/models/registry";

export async function GET(): Promise<Response> {
	return Response.json({
		models: availableModels().map((entry) => ({
			id: entry.id,
			label: entry.label,
			provider: entry.provider,
		})),
		defaultModelId: defaultModelId() ?? null,
	});
}
