import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF egress guard for server-side fetches of user-supplied URLs (RSS feeds,
 * article pages, academic-paper APIs). Without this, an attacker who can reach
 * the app — which ships with no authentication by default — can point a "source"
 * at internal addresses (`127.0.0.1`, `192.168.x`, the `169.254.169.254` cloud
 * metadata endpoint, …) and use the server as a proxy into the private network.
 *
 * The guard:
 *  - allows only `http`/`https`,
 *  - resolves the hostname and rejects any answer in a private/loopback/
 *    link-local/reserved range (IPv4 and IPv6, including IPv4-mapped v6),
 *  - re-validates every redirect hop (redirects are followed manually).
 *
 * A hostname that fails to resolve is allowed through — it cannot be an SSRF
 * target, and the subsequent fetch will simply fail. Full DNS-rebinding defense
 * (pinning the resolved IP for the actual connection) is out of scope; this is a
 * proportionate mitigation for a self-hosted, single-user app.
 */

const MAX_REDIRECTS = 5;

export class BlockedAddressError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BlockedAddressError";
	}
}

/** Parse a dotted-quad IPv4 string into a 32-bit unsigned integer. */
function ipv4ToInt(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const octet = Number(part);
		if (octet > 255) return null;
		value = value * 256 + octet;
	}
	return value >>> 0;
}

function inV4Range(value: number, base: string, maskBits: number): boolean {
	const baseInt = ipv4ToInt(base);
	if (baseInt === null) return false;
	const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
	return (value & mask) === (baseInt & mask);
}

/** True for IPv4 addresses that must never be reached from a fetch. */
function isPrivateIpv4(ip: string): boolean {
	const value = ipv4ToInt(ip);
	if (value === null) return true; // unparseable → treat as unsafe
	return (
		inV4Range(value, "0.0.0.0", 8) || // "this" network
		inV4Range(value, "10.0.0.0", 8) || // private
		inV4Range(value, "100.64.0.0", 10) || // CGNAT
		inV4Range(value, "127.0.0.0", 8) || // loopback
		inV4Range(value, "169.254.0.0", 16) || // link-local + cloud metadata
		inV4Range(value, "172.16.0.0", 12) || // private
		inV4Range(value, "192.0.0.0", 24) || // IETF protocol assignments
		inV4Range(value, "192.0.2.0", 24) || // TEST-NET-1
		inV4Range(value, "192.168.0.0", 16) || // private
		inV4Range(value, "198.18.0.0", 15) || // benchmarking
		inV4Range(value, "198.51.100.0", 24) || // TEST-NET-2
		inV4Range(value, "203.0.113.0", 24) || // TEST-NET-3
		inV4Range(value, "224.0.0.0", 4) || // multicast
		inV4Range(value, "240.0.0.0", 4) // reserved + broadcast
	);
}

/** True for IPv6 addresses that must never be reached from a fetch. */
function isPrivateIpv6(ip: string): boolean {
	const addr = ip.toLowerCase().split("%")[0]; // strip zone id
	if (addr === "::1" || addr === "::") return true;
	// IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — check the embedded v4.
	const mapped = addr.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isPrivateIpv4(mapped[1]);
	const firstHextet = addr.split(":")[0] ?? "";
	const high = Number.parseInt(firstHextet || "0", 16);
	if (Number.isNaN(high)) return true;
	if ((high & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
	if ((high & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((high & 0xff00) === 0xff00) return true; // ff00::/8 multicast
	return false;
}

function isPrivateAddress(ip: string): boolean {
	const kind = isIP(ip);
	if (kind === 4) return isPrivateIpv4(ip);
	if (kind === 6) return isPrivateIpv6(ip);
	return true; // not a recognizable IP → unsafe
}

/**
 * Assert that a URL is safe to fetch: http(s) scheme and a hostname that does
 * not resolve to a private/reserved address. Throws {@link BlockedAddressError}
 * on a disallowed scheme or address. Unresolvable hostnames pass (the fetch will
 * fail on its own).
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new BlockedAddressError("Invalid URL.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new BlockedAddressError(`Disallowed URL scheme: ${url.protocol}`);
	}

	const host = url.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]

	if (isIP(host) !== 0) {
		if (isPrivateAddress(host)) {
			throw new BlockedAddressError(`Blocked private address: ${host}`);
		}
		return;
	}

	let resolved: { address: string }[];
	try {
		resolved = await lookup(host, { all: true });
	} catch {
		// Unresolvable host: not an SSRF target — let the fetch fail naturally.
		return;
	}
	for (const entry of resolved) {
		if (isPrivateAddress(entry.address)) {
			throw new BlockedAddressError(
				`Blocked private address for ${host}: ${entry.address}`,
			);
		}
	}
}

export type SafeFetchOptions = RequestInit & {
	/** Override the underlying fetch (tests inject a mock; defaults to global). */
	fetchImpl?: typeof fetch;
};

/**
 * Drop-in replacement for `fetch` that enforces the SSRF guard on the initial
 * URL and on every redirect hop. Redirects are followed manually (up to
 * {@link MAX_REDIRECTS}) so each `Location` is validated before it is requested.
 * Throws {@link BlockedAddressError} when a target is disallowed.
 */
export async function safeFetch(
	url: string,
	options: SafeFetchOptions = {},
): Promise<Response> {
	const { fetchImpl, ...init } = options;
	const doFetch = fetchImpl ?? globalThis.fetch;

	let currentUrl = url;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		await assertPublicUrl(currentUrl);
		const response = await doFetch(currentUrl, {
			...init,
			redirect: "manual",
		});
		const status = response.status;
		const location = response.headers.get("location");
		if (status >= 300 && status < 400 && location) {
			currentUrl = new URL(location, currentUrl).toString();
			continue;
		}
		return response;
	}
	throw new BlockedAddressError("Too many redirects.");
}
