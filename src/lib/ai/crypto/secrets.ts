import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";

/**
 * At-rest encryption for the secrets noledge persists in SQLite — provider API
 * keys, OAuth access/refresh tokens, and the rerank API key. By default these
 * were stored in plaintext (the DB file is chmod 600, but that is best-effort
 * and a no-op on Windows). Setting `NOLEDGE_SECRET` turns on AES-256-GCM
 * encryption keyed from that secret, so a leaked DB file no longer yields live
 * credentials.
 *
 * Backward compatible by design:
 *  - No `NOLEDGE_SECRET` set  → values are stored and returned as plaintext,
 *    exactly as before.
 *  - `NOLEDGE_SECRET` set      → new writes are encrypted; reads transparently
 *    decrypt `enc:` values and pass through any legacy plaintext rows, so an
 *    existing database keeps working while it migrates on next write.
 *
 * The marker prefix lets {@link decryptSecret} tell ciphertext from plaintext
 * without a schema change.
 */

const PREFIX = "enc:v1:";
const KEY_SALT = "noledge-secret-kdf-v1";
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;
let cachedFrom: string | null = null;

/** Derive (and cache) the AES key from `NOLEDGE_SECRET`, or null when unset. */
function getKey(): Buffer | null {
	const secret = process.env.NOLEDGE_SECRET;
	if (!secret || secret.length === 0) return null;
	if (cachedKey && cachedFrom === secret) return cachedKey;
	cachedKey = scryptSync(secret, KEY_SALT, 32);
	cachedFrom = secret;
	return cachedKey;
}

/** True once a value carries the encryption marker. */
export function isEncrypted(value: string): boolean {
	return value.startsWith(PREFIX);
}

/**
 * Encrypt a secret for storage. Returns plaintext unchanged when no
 * `NOLEDGE_SECRET` is configured, so the feature is strictly opt-in.
 */
export function encryptSecret(plain: string): string {
	const key = getKey();
	if (!key) return plain;
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plain, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return `${PREFIX}${iv.toString("base64")}:${Buffer.concat([ciphertext, tag]).toString("base64")}`;
}

/**
 * Decrypt a stored secret. Plaintext (legacy / encryption-disabled) values are
 * returned as-is. Throws when an encrypted value is present but `NOLEDGE_SECRET`
 * is missing or wrong, since silently returning ciphertext would leak it to an
 * upstream API.
 */
export function decryptSecret(stored: string): string {
	if (!isEncrypted(stored)) return stored;
	const key = getKey();
	if (!key) {
		throw new Error(
			"Encrypted secret found but NOLEDGE_SECRET is not set. Set it to the value used when the secret was saved.",
		);
	}
	const [, , ivB64, payloadB64] = stored.split(":");
	if (!ivB64 || !payloadB64) {
		throw new Error("Malformed encrypted secret.");
	}
	const iv = Buffer.from(ivB64, "base64");
	const payload = Buffer.from(payloadB64, "base64");
	const tag = payload.subarray(payload.length - 16);
	const ciphertext = payload.subarray(0, payload.length - 16);
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]).toString("utf8");
}
