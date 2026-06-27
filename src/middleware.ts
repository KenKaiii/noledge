import { type NextRequest, NextResponse } from "next/server";
import {
	authEnabled,
	SESSION_COOKIE,
	verifySessionToken,
} from "@/lib/ai/auth/session";

/**
 * Optional auth gate. When `NOLEDGE_PASSWORD` is unset the app behaves exactly
 * as before (open, intended for localhost). When it is set, every request must
 * carry a valid signed session cookie; otherwise pages redirect to `/login` and
 * API calls get a 401. This makes the app safe to expose beyond localhost.
 */

/** Paths reachable without a session (login flow + the login page itself). */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

export async function middleware(request: NextRequest): Promise<NextResponse> {
	if (!authEnabled()) return NextResponse.next();

	const { pathname } = request.nextUrl;
	if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

	const token = request.cookies.get(SESSION_COOKIE)?.value;
	if (await verifySessionToken(token)) return NextResponse.next();

	if (pathname.startsWith("/api/")) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const loginUrl = new URL("/login", request.url);
	loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
	return NextResponse.redirect(loginUrl);
}

/**
 * Run on everything except Next internals and static assets, so the gate covers
 * all pages and API routes without intercepting the framework's own traffic.
 */
export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|robots.txt|sitemap.xml).*)",
	],
};
