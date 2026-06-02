import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["OPENAI_API_KEY"] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const key of KEYS) original[key] = process.env[key];
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

async function load() {
	return import("./provider-config");
}

describe("resolveProviderKey", () => {
	it("returns source 'none' when nothing is set", async () => {
		delete process.env.OPENAI_API_KEY;
		const { resolveProviderKey } = await load();
		const result = resolveProviderKey("openai");
		expect(result.source).toBe("none");
		expect(result.key).toBeUndefined();
	});

	it("uses the env key as a system source", async () => {
		process.env.OPENAI_API_KEY = "sk-system";
		const { resolveProviderKey } = await load();
		const result = resolveProviderKey("openai");
		expect(result.source).toBe("system");
		expect(result.key).toBe("sk-system");
	});

	it("prefers a locally stored key over the system key", async () => {
		process.env.OPENAI_API_KEY = "sk-system";
		const { resolveProviderKey, saveProviderKey } = await load();
		saveProviderKey("openai", "sk-local");
		const result = resolveProviderKey("openai");
		expect(result.source).toBe("local");
		expect(result.key).toBe("sk-local");
	});

	it("falls back to system after a local key is deleted", async () => {
		process.env.OPENAI_API_KEY = "sk-system";
		const { resolveProviderKey, saveProviderKey, deleteProviderKey } =
			await load();
		saveProviderKey("openai", "sk-local");
		expect(deleteProviderKey("openai")).toBe(true);
		const result = resolveProviderKey("openai");
		expect(result.source).toBe("system");
	});
});

describe("maskKey", () => {
	it("masks the middle of the key", async () => {
		const { maskKey } = await load();
		expect(maskKey("sk-abcdef1234")).toBe("sk-…1234");
		expect(maskKey("short")).toBe("••••");
	});
});
