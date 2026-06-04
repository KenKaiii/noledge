import crypto from "node:crypto";
import http from "node:http";
import { arch, hostname, release, type } from "node:os";
import type { Database } from "better-sqlite3";
import { getDatabase } from "@/lib/ai/db/client";
import {
	deleteProviderOAuthCredential,
	getProviderOAuthCredential,
	type ProviderOAuthCredential,
	saveProviderOAuthCredential,
} from "./provider-config";
import type { ProviderId } from "./types";

export type OAuthProviderId = Extract<
	ProviderId,
	"anthropic" | "openai" | "kimi"
>;

export type OAuthStartResult =
	| {
			ok: true;
			provider: OAuthProviderId;
			mode: "code";
			stateId: string;
			authUrl: string;
			instructions: string;
	  }
	| {
			ok: true;
			provider: "kimi";
			mode: "device";
			stateId: string;
			verificationUri: string;
			verificationUriComplete: string;
			userCode: string;
			intervalSeconds: number;
			expiresAt: number;
	  }
	| { ok: false; error: string };

type OAuthStateRow = {
	id: string;
	provider: OAuthProviderId;
	state: string | null;
	verifier: string | null;
	device_code: string | null;
	expires_at: number;
};

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_SCOPE =
	"openid profile email offline_access api.connectors.read api.connectors.invoke";

const ANTHROPIC_CLIENT_ID = atob(
	"OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl",
);
const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URLS = [
	"https://platform.claude.com/v1/oauth/token",
	"https://console.anthropic.com/v1/oauth/token",
] as const;
const ANTHROPIC_REDIRECT_URI =
	"https://platform.claude.com/oauth/code/callback";
const ANTHROPIC_SCOPE =
	"org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_OAUTH_HOST = "https://auth.kimi.com";
const KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";
const KIMI_CODE_VERSION = "1.0.11";
const KIMI_DEVICE_TIMEOUT_MS = 15 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

export function isOAuthProvider(provider: string): provider is OAuthProviderId {
	return (
		provider === "anthropic" || provider === "openai" || provider === "kimi"
	);
}

function randomId(): string {
	return crypto.randomUUID();
}

function base64url(bytes: Buffer): string {
	return bytes
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function createPkce(): { verifier: string; challenge: string } {
	const verifier = base64url(crypto.randomBytes(32));
	const challenge = base64url(
		crypto.createHash("sha256").update(verifier).digest(),
	);
	return { verifier, challenge };
}

function asciiHeader(value: string, fallback = "unknown"): string {
	const cleaned = value.replace(/[^\u0020-\u007E]/g, "").trim();
	return cleaned.length > 0 ? cleaned : fallback;
}

function kimiDeviceId(): string {
	return crypto
		.createHash("sha256")
		.update(`${hostname()}:${type()}:${release()}:${arch()}`)
		.digest("hex");
}

function kimiDeviceHeaders(): Record<string, string> {
	return {
		"X-Msh-Platform": "kimi_code_cli",
		"X-Msh-Version": KIMI_CODE_VERSION,
		"X-Msh-Device-Name": asciiHeader(hostname()),
		"X-Msh-Device-Model": asciiHeader(`${type()} ${release()} ${arch()}`),
		"X-Msh-Os-Version": asciiHeader(release()),
		"X-Msh-Device-Id": kimiDeviceId(),
	};
}

export function kimiCodingHeaders(): Record<string, string> {
	return {
		"User-Agent": `kimi-code-cli/${KIMI_CODE_VERSION}`,
		...kimiDeviceHeaders(),
	};
}

function saveState(row: OAuthStateRow, db: Database): void {
	db.prepare(
		`INSERT INTO provider_oauth_states (id, provider, state, verifier, device_code, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
			provider = excluded.provider,
			state = excluded.state,
			verifier = excluded.verifier,
			device_code = excluded.device_code,
			expires_at = excluded.expires_at,
			created_at = excluded.created_at`,
	).run(
		row.id,
		row.provider,
		row.state,
		row.verifier,
		row.device_code,
		row.expires_at,
		Date.now(),
	);
}

function getState(id: string, db: Database): OAuthStateRow | undefined {
	const row = db
		.prepare(
			"SELECT id, provider, state, verifier, device_code, expires_at FROM provider_oauth_states WHERE id = ?",
		)
		.get(id) as OAuthStateRow | undefined;
	if (!row || row.expires_at < Date.now()) return undefined;
	return row;
}

function deleteState(id: string, db: Database): void {
	db.prepare("DELETE FROM provider_oauth_states WHERE id = ?").run(id);
}

export async function startOAuth(
	provider: OAuthProviderId,
	db: Database = getDatabase(),
): Promise<OAuthStartResult> {
	if (provider === "kimi") return startKimiDevice(db);

	const stateId = randomId();
	const state = crypto.randomBytes(16).toString("hex");
	const { verifier, challenge } = createPkce();
	saveState(
		{
			id: stateId,
			provider,
			state,
			verifier,
			device_code: null,
			expires_at: Date.now() + 15 * 60 * 1000,
		},
		db,
	);

	if (provider === "anthropic") {
		const params = new URLSearchParams({
			code: "true",
			client_id: ANTHROPIC_CLIENT_ID,
			response_type: "code",
			redirect_uri: ANTHROPIC_REDIRECT_URI,
			scope: ANTHROPIC_SCOPE,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
		});
		return {
			ok: true,
			provider,
			mode: "code",
			stateId,
			authUrl: `${ANTHROPIC_AUTHORIZE_URL}?${params}`,
			instructions:
				"Sign in, then paste the code shown by Claude (code#state).",
		};
	}

	await startOpenAICallbackServer(stateId);

	const url = new URL(OPENAI_AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", OPENAI_CLIENT_ID);
	url.searchParams.set("redirect_uri", OPENAI_REDIRECT_URI);
	url.searchParams.set("scope", OPENAI_SCOPE);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", "ggcoder");
	return {
		ok: true,
		provider: "openai",
		mode: "code",
		stateId,
		authUrl: url.toString(),
		instructions:
			"Sign in. If localhost cannot load afterward, copy the full callback URL from the address bar and paste it here.",
	};
}

async function startOpenAICallbackServer(stateId: string): Promise<void> {
	let open = false;
	const closeServer = (): void => {
		if (!open) return;
		open = false;
		server.close();
	};
	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url ?? "", "http://localhost:1455");
		if (url.pathname !== "/auth/callback") {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not found");
			return;
		}

		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		if (!code || !state) {
			response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
			response.end(
				oauthHtml("OpenAI callback was missing code or state.", false),
			);
			closeServer();
			return;
		}

		try {
			const db = getDatabase();
			const row = getState(stateId, db);
			if (
				!row ||
				row.provider !== "openai" ||
				row.state !== state ||
				!row.verifier
			) {
				response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
				response.end(
					oauthHtml("OpenAI OAuth session expired or mismatched.", false),
				);
				closeServer();
				return;
			}

			const credential = await exchangeOpenAI(code, row.verifier);
			saveProviderOAuthCredential("openai", credential, db);
			deleteState(stateId, db);
			response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			response.end(
				oauthHtml(
					"OpenAI login complete. You can close this tab and return to noledge.",
					true,
				),
			);
		} catch (error) {
			response.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
			response.end(
				oauthHtml(
					error instanceof Error ? error.message : "OpenAI OAuth login failed.",
					false,
				),
			);
		} finally {
			closeServer();
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", (error) => {
			reject(
				error instanceof Error
					? error
					: new Error("Could not start OpenAI OAuth callback server."),
			);
		});
		server.listen(1455, "127.0.0.1", () => {
			open = true;
			resolve();
		});
	});

	setTimeout(closeServer, 10 * 60 * 1000).unref();
}

function oauthHtml(message: string, ok: boolean): string {
	return `<!doctype html><html><body style="font-family: system-ui; padding: 2rem;"><h1>${ok ? "Success" : "OAuth failed"}</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

async function startKimiDevice(db: Database): Promise<OAuthStartResult> {
	const response = await fetch(
		`${KIMI_OAUTH_HOST}/api/oauth/device_authorization`,
		{
			method: "POST",
			headers: {
				...kimiDeviceHeaders(),
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({ client_id: KIMI_CLIENT_ID }).toString(),
		},
	);
	if (!response.ok) {
		return {
			ok: false,
			error: `Kimi authorization failed (${response.status}).`,
		};
	}
	const data = (await response.json()) as {
		user_code?: string;
		device_code?: string;
		verification_uri?: string;
		verification_uri_complete?: string;
		interval?: number;
	};
	if (!data.user_code || !data.device_code || !data.verification_uri) {
		return { ok: false, error: "Kimi authorization response was incomplete." };
	}
	const stateId = randomId();
	const expiresAt = Date.now() + KIMI_DEVICE_TIMEOUT_MS;
	saveState(
		{
			id: stateId,
			provider: "kimi",
			state: null,
			verifier: null,
			device_code: data.device_code,
			expires_at: expiresAt,
		},
		db,
	);
	return {
		ok: true,
		provider: "kimi",
		mode: "device",
		stateId,
		verificationUri: data.verification_uri,
		verificationUriComplete:
			data.verification_uri_complete ?? data.verification_uri,
		userCode: data.user_code,
		intervalSeconds: data.interval ?? 5,
		expiresAt,
	};
}

export async function completeOAuth(
	stateId: string,
	input: string,
	db: Database = getDatabase(),
): Promise<
	{ ok: true; provider: OAuthProviderId } | { ok: false; error: string }
> {
	const row = getState(stateId, db);
	if (!row) return { ok: false, error: "OAuth session expired. Start again." };
	if (row.provider === "kimi") return pollKimi(row, db);
	if (!row.verifier || !row.state) {
		return { ok: false, error: "OAuth session is invalid. Start again." };
	}
	const parsed = parseCodeInput(input);
	if (!parsed.code) return { ok: false, error: "No authorization code found." };
	if (parsed.state && parsed.state !== row.state) {
		return { ok: false, error: "OAuth state mismatch. Start again." };
	}

	const credential = await exchangeCode(
		row.provider,
		parsed.code,
		row.verifier,
		row.state,
	);
	saveProviderOAuthCredential(row.provider, credential, db);
	deleteState(stateId, db);
	return { ok: true, provider: row.provider };
}

export async function completeOAuthCallback(
	provider: OAuthProviderId,
	stateValue: string,
	code: string,
	db: Database = getDatabase(),
): Promise<{ ok: true } | { ok: false; error: string }> {
	const [stateId, state] = stateValue.split(":", 2);
	if (!stateId || !state) return { ok: false, error: "Invalid OAuth state." };
	const row = getState(stateId, db);
	if (
		provider === "kimi" ||
		!row ||
		row.provider !== provider ||
		row.state !== state ||
		!row.verifier
	) {
		return { ok: false, error: "OAuth session expired or mismatched." };
	}
	const credential = await exchangeCode(
		provider,
		code,
		row.verifier,
		row.state,
	);
	saveProviderOAuthCredential(provider, credential, db);
	deleteState(stateId, db);
	return { ok: true };
}

function parseCodeInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {}
	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return { code, state };
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
		};
	}
	return { code: value };
}

async function exchangeCode(
	provider: Exclude<OAuthProviderId, "kimi">,
	code: string,
	verifier: string,
	state: string,
): Promise<ProviderOAuthCredential> {
	if (provider === "openai") return exchangeOpenAI(code, verifier);
	return exchangeAnthropic(code, verifier, state);
}

async function exchangeOpenAI(
	code: string,
	verifier: string,
): Promise<ProviderOAuthCredential> {
	const response = await fetch(OPENAI_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: OPENAI_CLIENT_ID,
			code,
			redirect_uri: OPENAI_REDIRECT_URI,
			code_verifier: verifier,
		}),
	});
	if (!response.ok) {
		throw new Error(`OpenAI token exchange failed (${response.status}).`);
	}
	const data = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
	};
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: Date.now() + data.expires_in * 1000,
	};
}

async function exchangeAnthropic(
	code: string,
	verifier: string,
	state: string,
): Promise<ProviderOAuthCredential> {
	let lastError: Error | null = null;
	for (const url of ANTHROPIC_TOKEN_URLS) {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "claude-cli/2.1.88 (external, cli)",
				"anthropic-beta": "oauth-2025-04-20",
			},
			body: JSON.stringify({
				grant_type: "authorization_code",
				client_id: ANTHROPIC_CLIENT_ID,
				code,
				state,
				redirect_uri: ANTHROPIC_REDIRECT_URI,
				code_verifier: verifier,
			}),
		});
		if (response.ok) {
			const data = (await response.json()) as {
				access_token: string;
				refresh_token: string;
				expires_in: number;
			};
			return {
				accessToken: data.access_token,
				refreshToken: data.refresh_token,
				expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
			};
		}
		lastError = new Error(
			`Anthropic token exchange failed (${response.status}).`,
		);
	}
	throw lastError ?? new Error("Anthropic token exchange failed.");
}

async function refreshOpenAI(
	refreshToken: string,
): Promise<ProviderOAuthCredential> {
	const response = await fetch(OPENAI_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: OPENAI_CLIENT_ID,
			refresh_token: refreshToken,
		}),
	});
	if (!response.ok) {
		throw new Error(`OpenAI token refresh failed (${response.status}).`);
	}
	const data = (await response.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
	};
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? refreshToken,
		expiresAt: Date.now() + data.expires_in * 1000,
	};
}

async function refreshAnthropic(
	refreshToken: string,
): Promise<ProviderOAuthCredential> {
	let lastError: Error | null = null;
	for (const url of ANTHROPIC_TOKEN_URLS) {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "claude-cli/2.1.88 (external, cli)",
				"anthropic-beta": "oauth-2025-04-20",
			},
			body: JSON.stringify({
				grant_type: "refresh_token",
				client_id: ANTHROPIC_CLIENT_ID,
				refresh_token: refreshToken,
			}),
		});
		if (response.ok) {
			const data = (await response.json()) as {
				access_token: string;
				refresh_token?: string;
				expires_in: number;
			};
			return {
				accessToken: data.access_token,
				refreshToken: data.refresh_token ?? refreshToken,
				expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
			};
		}
		lastError = new Error(
			`Anthropic token refresh failed (${response.status}).`,
		);
	}
	throw lastError ?? new Error("Anthropic token refresh failed.");
}

async function refreshKimi(
	refreshToken: string,
): Promise<ProviderOAuthCredential> {
	const response = await fetch(`${KIMI_OAUTH_HOST}/api/oauth/token`, {
		method: "POST",
		headers: {
			...kimiDeviceHeaders(),
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams({
			client_id: KIMI_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}).toString(),
	});
	if (!response.ok) {
		throw new Error(`Kimi token refresh failed (${response.status}).`);
	}
	const data = (await response.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
	};
	if (!data.access_token || !data.expires_in) {
		throw new Error("Kimi token refresh response was incomplete.");
	}
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? refreshToken,
		expiresAt: Date.now() + data.expires_in * 1000,
		baseURL: KIMI_CODE_BASE_URL,
	};
}

async function refreshProvider(
	provider: OAuthProviderId,
	refreshToken: string,
): Promise<ProviderOAuthCredential> {
	if (provider === "openai") return refreshOpenAI(refreshToken);
	if (provider === "anthropic") return refreshAnthropic(refreshToken);
	return refreshKimi(refreshToken);
}

export async function refreshExpiredOAuthCredentials(
	db: Database = getDatabase(),
): Promise<void> {
	for (const provider of [
		"openai",
		"anthropic",
		"kimi",
	] satisfies OAuthProviderId[]) {
		const credential = getProviderOAuthCredential(provider, db);
		if (!credential?.expires_at) continue;
		if (credential.expires_at > Date.now() + TOKEN_REFRESH_SKEW_MS) continue;
		if (!credential.refresh_token) {
			deleteProviderOAuthCredential(provider, db);
			continue;
		}
		try {
			const refreshed = await refreshProvider(
				provider,
				credential.refresh_token,
			);
			saveProviderOAuthCredential(provider, refreshed, db);
		} catch {
			deleteProviderOAuthCredential(provider, db);
		}
	}
}

async function pollKimi(
	row: OAuthStateRow,
	db: Database,
): Promise<{ ok: true; provider: "kimi" } | { ok: false; error: string }> {
	if (!row.device_code)
		return { ok: false, error: "Kimi OAuth session is invalid." };
	const response = await fetch(`${KIMI_OAUTH_HOST}/api/oauth/token`, {
		method: "POST",
		headers: {
			...kimiDeviceHeaders(),
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams({
			client_id: KIMI_CLIENT_ID,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: row.device_code,
		}).toString(),
	});
	const data = (await response.json().catch(() => ({}))) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		error?: string;
		error_description?: string;
	};
	if (!response.ok) {
		if (data.error === "authorization_pending") {
			return {
				ok: false,
				error: "Authorization pending. Finish sign-in, then try again.",
			};
		}
		return {
			ok: false,
			error:
				data.error_description ??
				data.error ??
				`Kimi token polling failed (${response.status}).`,
		};
	}
	if (!data.access_token || !data.refresh_token || !data.expires_in) {
		return { ok: false, error: "Kimi token response was incomplete." };
	}
	saveProviderOAuthCredential(
		"kimi",
		{
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + data.expires_in * 1000,
			baseURL: KIMI_CODE_BASE_URL,
		},
		db,
	);
	deleteState(row.id, db);
	return { ok: true, provider: "kimi" };
}
