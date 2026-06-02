import path from "node:path";
import { z } from "zod";

/**
 * Server-side environment configuration for the AI + RAG stack.
 *
 * API keys are optional: a provider whose key is absent is filtered out of the
 * model registry/catalog rather than crashing the app at boot. OCR settings have
 * sensible defaults.
 */

const envSchema = z.object({
	OPENAI_API_KEY: z.string().min(1).optional(),
	ANTHROPIC_API_KEY: z.string().min(1).optional(),
	MOONSHOT_API_KEY: z.string().min(1).optional(),
	MINIMAX_API_KEY: z.string().min(1).optional(),
	OCR_ENABLED: z
		.enum(["true", "false"])
		.default("true")
		.transform((value) => value === "true"),
	OCR_LANGUAGE: z.string().min(1).default("eng"),
});

export type AiEnv = z.infer<typeof envSchema> & {
	readonly dbPath: string;
};

let cached: AiEnv | null = null;

/** Parse and cache the validated server environment. */
export function getEnv(): AiEnv {
	if (cached) return cached;

	const parsed = envSchema.parse({
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
		MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
		MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
		OCR_ENABLED: process.env.OCR_ENABLED,
		OCR_LANGUAGE: process.env.OCR_LANGUAGE,
	});

	cached = {
		...parsed,
		dbPath:
			process.env.NOLEDGE_DB_PATH ??
			path.join(process.cwd(), ".data", "noledge.db"),
	};
	return cached;
}
