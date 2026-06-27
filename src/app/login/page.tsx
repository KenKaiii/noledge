"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Password gate shown when `NOLEDGE_PASSWORD` is configured. Posts to
 * `/api/auth/login`, which sets the session cookie on success; the page then
 * redirects to the originally requested path (`?next=`).
 */
export default function LoginPage() {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function onSubmit(event: React.FormEvent): Promise<void> {
		event.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const response = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password }),
			});
			if (!response.ok) {
				const data = (await response.json().catch(() => ({}))) as {
					error?: string;
				};
				setError(data.error ?? "Login failed.");
				return;
			}
			const params = new URLSearchParams(window.location.search);
			const next = params.get("next");
			window.location.href = next?.startsWith("/") ? next : "/";
		} catch {
			setError("Login failed. Try again.");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			<form
				onSubmit={onSubmit}
				className="w-full max-w-sm space-y-4 rounded-xl border p-6"
			>
				<div className="space-y-1">
					<h1 className="font-semibold text-lg">noledge</h1>
					<p className="text-muted-foreground text-sm">
						Enter your password to continue.
					</p>
				</div>
				<Input
					type="password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					placeholder="Password"
					autoFocus
					autoComplete="current-password"
				/>
				{error ? <p className="text-destructive text-sm">{error}</p> : null}
				<Button type="submit" className="w-full" disabled={submitting}>
					{submitting ? "Signing in…" : "Sign in"}
				</Button>
			</form>
		</div>
	);
}
