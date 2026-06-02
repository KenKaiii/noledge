import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = [
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"MOONSHOT_API_KEY",
	"MINIMAX_API_KEY",
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const key of KEYS) original[key] = process.env[key];
	// Isolate from the on-disk dev DB so local keys never interfere.
	process.env.NOLEDGE_DB_PATH = ":memory:";
	vi.resetModules();
});

afterEach(() => {
	for (const key of KEYS) {
		if (original[key] === undefined) delete process.env[key];
		else process.env[key] = original[key];
	}
	delete process.env.NOLEDGE_DB_PATH;
});

async function loadRegistry() {
	return import("./registry");
}

describe("model registry", () => {
	it("includes only providers with a configured key", async () => {
		for (const key of KEYS) delete process.env[key];
		process.env.OPENAI_API_KEY = "sk-test";

		const { availableModels } = await loadRegistry();
		const providers = new Set(availableModels().map((m) => m.provider));
		expect(providers).toEqual(new Set(["openai"]));
	});

	it("resolves a LanguageModel for a configured provider", async () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const { resolveModel } = await loadRegistry();
		const result = resolveModel("claude-opus-4-8");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.model).toBeDefined();
	});

	it("errors for an unknown model id", async () => {
		process.env.OPENAI_API_KEY = "sk-test";
		const { resolveModel } = await loadRegistry();
		const result = resolveModel("does-not-exist");
		expect(result.ok).toBe(false);
	});

	it("errors when the provider has no key", async () => {
		for (const key of KEYS) delete process.env[key];
		process.env.OPENAI_API_KEY = "sk-test";
		const { resolveModel } = await loadRegistry();
		const result = resolveModel("claude-opus-4-8");
		expect(result.ok).toBe(false);
	});
});
