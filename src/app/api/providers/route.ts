import { z } from "zod";
import {
	deleteProviderKey,
	maskKey,
	PROVIDER_META,
	resolveProviderKey,
	saveProviderKey,
} from "@/lib/ai/models/provider-config";
import { PROVIDER_IDS, type ProviderId } from "@/lib/ai/models/types";
import { validateProviderKey } from "@/lib/ai/models/validate";

type ProviderStatus = {
	id: ProviderId;
	label: string;
	hint: string;
	envVar: string;
	connected: boolean;
	source: "system" | "local" | "none";
	maskedKey: string | null;
};

function statusFor(id: ProviderId): ProviderStatus {
	const meta = PROVIDER_META[id];
	const { key, source } = resolveProviderKey(id);
	return {
		id,
		label: meta.label,
		hint: meta.hint,
		envVar: meta.envVar,
		connected: Boolean(key),
		source,
		maskedKey: key ? maskKey(key) : null,
	};
}

/** List all providers with their connection status. */
export async function GET(): Promise<Response> {
	return Response.json({
		providers: PROVIDER_IDS.map(statusFor),
	});
}

const providerSchema = z.enum(PROVIDER_IDS);

const postSchema = z.object({
	provider: providerSchema,
	apiKey: z.string().min(1, "API key is required"),
});

/** Validate then store a provider API key. */
export async function POST(request: Request): Promise<Response> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = postSchema.safeParse(raw);
	if (!parsed.success) {
		return Response.json(
			{ error: parsed.error.issues[0]?.message ?? "Invalid request" },
			{ status: 400 },
		);
	}

	const { provider, apiKey } = parsed.data;

	const validation = await validateProviderKey(provider, apiKey.trim());
	if (!validation.ok) {
		return Response.json({ error: validation.error }, { status: 422 });
	}

	saveProviderKey(provider, apiKey.trim());
	return Response.json({ provider: statusFor(provider) });
}

/** Remove a locally stored provider key. */
export async function DELETE(request: Request): Promise<Response> {
	const raw = new URL(request.url).searchParams.get("provider");
	const parsed = providerSchema.safeParse(raw);
	if (!parsed.success) {
		return Response.json({ error: "Unknown provider" }, { status: 400 });
	}

	deleteProviderKey(parsed.data);
	return Response.json({ provider: statusFor(parsed.data) });
}
