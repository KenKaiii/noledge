import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/ai/auth/session";

/** Clear the session cookie. */
export async function POST(): Promise<Response> {
	const response = NextResponse.json({ ok: true });
	response.cookies.set(SESSION_COOKIE, "", {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		maxAge: 0,
		secure: process.env.NOLEDGE_COOKIE_SECURE === "true",
	});
	return response;
}
