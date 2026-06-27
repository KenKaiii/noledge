/**
 * Minimal signed-cookie session for the optional auth gate.
 *
 * The app is built for single-user, localhost use and ships with no auth. When
 * the operator sets `NOLEDGE_PASSWORD`, the middleware requires a valid session
 * cookie so the app is safe to expose on a LAN or behind a tunnel. The token is
 * a stateless HMAC-signed expiry stamp — no server-side session store needed.
 *
 * This module is Edge-runtime safe (Web Crypto only, no `node:` imports) so it
 * can be imported by `middleware.ts` as well as by the Node route handlers.
 */

export const SESSION_COOKIE = "noledge_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** The signing secret: explicit `NOLEDGE_SECRET`, else the password itself. */
function authSecret(): string | null {
	return process.env.NOLEDGE_SECRET || process.env.NOLEDGE_PASSWORD || null;
}

/** Whether the auth gate is active (a password has been configured). */
export function authEnabled(): boolean {
	return Boolean(process.env.NOLEDGE_PASSWORD);
}

function b64urlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

/** Create a signed session token valid for {@link SESSION_TTL_SECONDS}. */
export async function createSessionToken(): Promise<string> {
	const secret = authSecret();
	if (!secret) throw new Error("Cannot create a session without a secret.");
	const payload = JSON.stringify({
		exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
	});
	const payloadPart = b64urlEncode(new TextEncoder().encode(payload));
	const key = await hmacKey(secret);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(payloadPart),
	);
	return `${payloadPart}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verify a session token's signature and expiry. */
export async function verifySessionToken(
	token: string | undefined,
): Promise<boolean> {
	if (!token) return false;
	const secret = authSecret();
	if (!secret) return false;
	const [payloadPart, sigPart] = token.split(".");
	if (!payloadPart || !sigPart) return false;
	try {
		const key = await hmacKey(secret);
		const valid = await crypto.subtle.verify(
			"HMAC",
			key,
			b64urlDecode(sigPart),
			new TextEncoder().encode(payloadPart),
		);
		if (!valid) return false;
		const payload = JSON.parse(
			new TextDecoder().decode(b64urlDecode(payloadPart)),
		) as { exp?: number };
		return (
			typeof payload.exp === "number" &&
			payload.exp > Math.floor(Date.now() / 1000)
		);
	} catch {
		return false;
	}
}
