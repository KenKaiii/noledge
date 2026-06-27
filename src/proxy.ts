import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
	authEnabled,
	SESSION_COOKIE,
	verifySessionToken,
} from "@/lib/ai/auth/session";

/**
 * Request gate (Next.js "proxy", formerly "middleware"). Two layers:
 *
 * 1. Optional auth (all routes). When `NOLEDGE_PASSWORD` is set, every request
 *    must carry a valid signed session cookie; pages redirect to `/login`, API
 *    routes get a 401. Unset → no auth (the default, localhost-only model).
 *
 * 2. Cross-origin / DNS-rebinding guard (`/api/*`). This is a local-first app;
 *    Next's built-in cross-site protection only covers `/_next`/`/__nextjs`, so
 *    route handlers under `/api/*` would otherwise be reachable via CSRF
 *    ("simple" requests) or DNS-rebinding.
 *
 *    Defenses (any failure -> 403):
 *     (a) Origin header, when present, must match the Host (blocks CSRF).
 *     (b) Sec-Fetch-Site, when present, must be same-origin/same-site/none.
 *     (c) Host must be a loopback name — UNLESS auth is enabled, in which case
 *         the operator has deliberately opted into remote access and the session
 *         cookie is the access control. The Origin/Sec-Fetch checks above still
 *         apply, so CSRF protection is retained even when exposed.
 */

const ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
	"::1",
]);

const ALLOWED_FETCH_SITES: ReadonlySet<string> = new Set([
	"same-origin",
	"same-site",
	"none",
]);

/** Paths reachable without a session (the login flow itself). */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
	"/login",
	"/api/auth/login",
	"/api/auth/logout",
]);

/** Extract the bare hostname (no port) from a `Host` header value. */
function hostnameOf(hostHeader: string): string {
	const value = hostHeader.trim().toLowerCase();
	// IPv6 literal, e.g. "[::1]" or "[::1]:3000".
	if (value.startsWith("[")) {
		const end = value.indexOf("]");
		return end === -1 ? value : value.slice(0, end + 1);
	}
	// "host" or "host:port".
	const colon = value.indexOf(":");
	return colon === -1 ? value : value.slice(0, colon);
}

function forbidden(reason: string): NextResponse {
	return NextResponse.json(
		{ error: "Forbidden", reason },
		{ status: 403, headers: { "Cache-Control": "no-store" } },
	);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
	const { pathname } = request.nextUrl;
	const isApi = pathname.startsWith("/api/");
	const gated = authEnabled();

	// 1) Auth gate.
	if (gated && !PUBLIC_PATHS.has(pathname)) {
		const token = request.cookies.get(SESSION_COOKIE)?.value;
		if (!(await verifySessionToken(token))) {
			if (isApi) {
				return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
			}
			const loginUrl = new URL("/login", request.url);
			loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
			return NextResponse.redirect(loginUrl);
		}
	}

	// 2) Cross-origin / DNS-rebinding guard for API routes.
	if (isApi) {
		const host = request.headers.get("host") ?? "";

		// (c) Loopback-only, except when auth is enabled (remote access is then
		// intentional and the session cookie is the access control).
		if (!gated && !ALLOWED_HOSTNAMES.has(hostnameOf(host))) {
			return forbidden("host");
		}

		// (a) CSRF: a cross-origin request carries an Origin whose host differs.
		const origin = request.headers.get("origin");
		if (origin !== null) {
			let originHost: string;
			try {
				originHost = new URL(origin).host;
			} catch {
				return forbidden("origin");
			}
			if (originHost.toLowerCase() !== host.toLowerCase()) {
				return forbidden("origin");
			}
		}

		// (b) Fetch metadata: reject explicit cross-site requests.
		const secFetchSite = request.headers.get("sec-fetch-site");
		if (secFetchSite !== null && !ALLOWED_FETCH_SITES.has(secFetchSite)) {
			return forbidden("sec-fetch-site");
		}
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|robots.txt|sitemap.xml).*)",
	],
};
