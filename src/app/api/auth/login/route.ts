import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
	authEnabled,
	createSessionToken,
	SESSION_COOKIE,
	SESSION_TTL_SECONDS,
} from "@/lib/ai/auth/session";

const bodySchema = z.object({ password: z.string().min(1) });

/** Constant-time comparison of two strings via fixed-length SHA-256 digests. */
function safeEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}

export async function POST(request: Request): Promise<Response> {
	const expected = process.env.NOLEDGE_PASSWORD;
	if (!authEnabled() || !expected) {
		return NextResponse.json(
			{ error: "Auth is not enabled." },
			{ status: 400 },
		);
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return NextResponse.json({ error: "Password required." }, { status: 400 });
	}

	if (!safeEqual(parsed.data.password, expected)) {
		return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
	}

	const token = await createSessionToken();
	const response = NextResponse.json({ ok: true });
	response.cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		maxAge: SESSION_TTL_SECONDS,
		secure: process.env.NOLEDGE_COOKIE_SECURE === "true",
	});
	return response;
}
