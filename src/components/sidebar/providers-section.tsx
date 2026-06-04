"use client";

import { Check, CircleNotch, Key, Plus, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ProviderStatus = {
	id: string;
	label: string;
	hint: string;
	envVar: string;
	oauth: boolean;
	connected: boolean;
	source: "oauth" | "system" | "local" | "none";
	maskedKey: string | null;
};

type DraftState = {
	value: string;
	saving: boolean;
	error: string | null;
};

type OAuthState = {
	provider: string;
	stateId: string;
	mode: "code" | "device";
	url: string;
	instructions: string;
	code: string;
	userCode?: string;
	autoComplete: boolean;
	saving: boolean;
	error: string | null;
};

function emptyDraft(): DraftState {
	return { value: "", saving: false, error: null };
}

export function ProvidersSection(): React.JSX.Element {
	const [providers, setProviders] = useState<ProviderStatus[]>([]);
	const [loading, setLoading] = useState(true);
	const [editing, setEditing] = useState<string | null>(null);
	const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
	const [removing, setRemoving] = useState<string | null>(null);
	const [oauth, setOauth] = useState<OAuthState | null>(null);

	const load = useCallback(async (): Promise<void> => {
		try {
			const response = await fetch("/api/providers");
			const data = (await response.json()) as { providers: ProviderStatus[] };
			setProviders(data.providers);
		} catch {
			setProviders([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const setDraft = useCallback(
		(id: string, patch: Partial<DraftState>): void => {
			setDrafts((prev) => ({
				...prev,
				[id]: { ...(prev[id] ?? emptyDraft()), ...patch },
			}));
		},
		[],
	);

	const openEditor = useCallback(
		(id: string): void => {
			setEditing(id);
			setDraft(id, { value: "", error: null });
		},
		[setDraft],
	);

	const cancelEditor = useCallback((): void => {
		setEditing(null);
	}, []);

	const save = useCallback(
		async (id: string): Promise<void> => {
			const draft = drafts[id] ?? emptyDraft();
			const apiKey = draft.value.trim();
			if (apiKey.length === 0) {
				setDraft(id, { error: "Enter an API key." });
				return;
			}

			setDraft(id, { saving: true, error: null });
			try {
				const response = await fetch("/api/providers", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ provider: id, apiKey }),
				});
				const data = (await response.json()) as {
					provider?: ProviderStatus;
					error?: string;
				};
				if (response.ok && data.provider) {
					setProviders((prev) =>
						prev.map((p) =>
							p.id === id ? (data.provider as ProviderStatus) : p,
						),
					);
					setEditing(null);
					setDraft(id, { value: "", saving: false, error: null });
				} else {
					setDraft(id, {
						saving: false,
						error: data.error ?? "Could not validate key.",
					});
				}
			} catch (error) {
				setDraft(id, {
					saving: false,
					error: error instanceof Error ? error.message : "Request failed.",
				});
			}
		},
		[drafts, setDraft],
	);

	const startOAuth = useCallback(async (id: string): Promise<void> => {
		setOauth(null);
		try {
			const response = await fetch("/api/providers/oauth/start", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider: id }),
			});
			const data = (await response.json()) as
				| {
						ok: true;
						mode: "code";
						stateId: string;
						authUrl: string;
						instructions: string;
				  }
				| {
						ok: true;
						mode: "device";
						stateId: string;
						verificationUri: string;
						verificationUriComplete: string;
						userCode: string;
				  }
				| { ok: false; error?: string };
			if (!response.ok || !data.ok) {
				setOauth({
					provider: id,
					stateId: "",
					mode: "code",
					url: "",
					instructions: "",
					code: "",
					autoComplete: false,
					saving: false,
					error: data.ok
						? "Could not start OAuth login."
						: (data.error ?? "Could not start OAuth login."),
				});
				return;
			}
			const url =
				data.mode === "code" ? data.authUrl : data.verificationUriComplete;
			window.open(url, "_blank", "noopener,noreferrer");
			const autoComplete = id === "openai" && data.mode === "code";
			setOauth({
				provider: id,
				stateId: data.stateId,
				mode: data.mode,
				url,
				instructions: autoComplete
					? "Complete sign-in in the browser. noledge will connect OpenAI automatically when the callback returns."
					: data.mode === "code"
						? data.instructions
						: "Sign in with Kimi using the code below, then click Complete.",
				code: "",
				autoComplete,
				...(data.mode === "device" ? { userCode: data.userCode } : {}),
				saving: false,
				error: null,
			});
		} catch (error) {
			setOauth({
				provider: id,
				stateId: "",
				mode: "code",
				url: "",
				instructions: "",
				code: "",
				autoComplete: false,
				saving: false,
				error:
					error instanceof Error
						? error.message
						: "Could not start OAuth login.",
			});
		}
	}, []);

	const completeOAuth = useCallback(async (): Promise<void> => {
		if (!oauth?.stateId) return;
		setOauth((prev) => (prev ? { ...prev, saving: true, error: null } : prev));
		try {
			const response = await fetch("/api/providers/oauth/complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ stateId: oauth.stateId, input: oauth.code }),
			});
			const data = (await response.json()) as { ok?: boolean; error?: string };
			if (response.ok && data.ok) {
				setOauth(null);
				await load();
				return;
			}
			setOauth((prev) =>
				prev
					? {
							...prev,
							saving: false,
							error: data.error ?? "OAuth login failed.",
						}
					: prev,
			);
		} catch (error) {
			setOauth((prev) =>
				prev
					? {
							...prev,
							saving: false,
							error:
								error instanceof Error ? error.message : "OAuth login failed.",
						}
					: prev,
			);
		}
	}, [load, oauth]);

	useEffect(() => {
		if (!oauth?.autoComplete) return;

		const interval = window.setInterval(async () => {
			try {
				const response = await fetch("/api/providers");
				const data = (await response.json()) as {
					providers: ProviderStatus[];
				};
				setProviders(data.providers);
				const provider = data.providers.find(
					(item) => item.id === oauth.provider,
				);
				if (provider?.source === "oauth") setOauth(null);
			} catch {
				// Keep waiting; the callback server handles the actual OAuth result.
			}
		}, 1500);

		return () => window.clearInterval(interval);
	}, [oauth?.autoComplete, oauth?.provider]);

	const remove = useCallback(async (id: string): Promise<void> => {
		setRemoving(id);
		try {
			const response = await fetch(
				`/api/providers?provider=${encodeURIComponent(id)}`,
				{ method: "DELETE" },
			);
			const data = (await response.json()) as { provider?: ProviderStatus };
			if (response.ok && data.provider) {
				setProviders((prev) =>
					prev.map((p) =>
						p.id === id ? (data.provider as ProviderStatus) : p,
					),
				);
			}
		} finally {
			setRemoving(null);
		}
	}, []);

	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">
				Connect a provider with OAuth or an API key. OAuth is used first when
				both are available.
			</p>

			{loading ? (
				<div className="flex items-center justify-center py-6">
					<CircleNotch className="size-5 animate-spin text-muted-foreground" />
				</div>
			) : (
				<ul className="flex flex-col divide-y">
					{providers.map((provider) => {
						const draft = drafts[provider.id] ?? emptyDraft();
						const isEditing = editing === provider.id;
						return (
							<li key={provider.id}>
								<div className="flex items-center justify-between gap-3 py-4">
									<div className="flex min-w-0 items-center gap-2.5">
										<span
											className={cn(
												"size-2 shrink-0 rounded-full",
												provider.connected
													? "bg-emerald-500"
													: "bg-muted-foreground/30",
											)}
											aria-hidden
										/>
										<div className="min-w-0">
											<div className="flex items-center gap-2">
												<span className="text-sm font-medium">
													{provider.label}
												</span>
												{provider.connected ? (
													<span
														className={cn(
															"rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
															provider.source === "oauth"
																? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
																: provider.source === "system"
																	? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
																	: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
														)}
													>
														{provider.source === "oauth"
															? "OAuth"
															: provider.source === "system"
																? "System"
																: "Connected"}
													</span>
												) : null}
											</div>
											{provider.connected && provider.maskedKey ? (
												<p className="truncate text-xs text-muted-foreground">
													{provider.maskedKey}
												</p>
											) : (
												<a
													href={provider.hint}
													target="_blank"
													rel="noreferrer"
													className="block truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
												>
													{provider.hint}
												</a>
											)}
										</div>
									</div>

									{!isEditing ? (
										<div className="flex shrink-0 items-center gap-1">
											{provider.oauth ? (
												<Button
													variant="outline"
													size="sm"
													type="button"
													onClick={() => void startOAuth(provider.id)}
												>
													<Key className="size-3.5" />
													Login
												</Button>
											) : null}
											{provider.source === "local" ? (
												<Button
													variant="ghost"
													size="icon"
													type="button"
													className="size-8 text-muted-foreground"
													aria-label={`Remove ${provider.label} key`}
													disabled={removing === provider.id}
													onClick={() => void remove(provider.id)}
												>
													{removing === provider.id ? (
														<CircleNotch className="size-4 animate-spin" />
													) : (
														<Trash className="size-4" />
													)}
												</Button>
											) : null}
											<Button
												variant="outline"
												size="sm"
												type="button"
												onClick={() => openEditor(provider.id)}
											>
												{provider.source === "local" ? (
													"Replace"
												) : (
													<>
														<Plus className="size-3.5" />
														Add key
													</>
												)}
											</Button>
										</div>
									) : null}
								</div>

								{oauth?.provider === provider.id ? (
									<div className="mt-2.5 mb-4 space-y-2 rounded-lg border bg-muted/20 p-3">
										<p className="text-xs text-muted-foreground">
											{oauth.instructions}{" "}
											{oauth.userCode ? `Code: ${oauth.userCode}` : ""}
										</p>
										<a
											href={oauth.url}
											target="_blank"
											rel="noreferrer"
											className="block truncate text-xs text-primary underline-offset-2 hover:underline"
										>
											Open login page
										</a>
										{oauth.autoComplete ? (
											<div className="flex items-center gap-2 text-xs text-muted-foreground">
												<CircleNotch className="size-3.5 animate-spin" />
												Waiting for OpenAI callback…
											</div>
										) : oauth.mode === "code" ? (
											<Input
												value={oauth.code}
												placeholder="Paste OAuth code or callback URL"
												disabled={oauth.saving}
												onChange={(event) =>
													setOauth((prev) =>
														prev
															? {
																	...prev,
																	code: event.target.value,
																	error: null,
																}
															: prev,
													)
												}
											/>
										) : null}
										<div className="flex justify-end gap-2">
											<Button
												variant="ghost"
												size="sm"
												type="button"
												disabled={oauth.saving}
												onClick={() => setOauth(null)}
											>
												Cancel
											</Button>
											{oauth.autoComplete ? null : (
												<Button
													size="sm"
													type="button"
													disabled={
														oauth.saving ||
														(oauth.mode === "code" &&
															oauth.code.trim().length === 0)
													}
													onClick={() => void completeOAuth()}
												>
													{oauth.saving ? (
														<CircleNotch className="size-4 animate-spin" />
													) : null}
													Complete login
												</Button>
											)}
										</div>
										{oauth.error ? (
											<p className="text-xs text-destructive">{oauth.error}</p>
										) : null}
									</div>
								) : null}

								{isEditing ? (
									<div className="mt-2.5 mb-4 space-y-2">
										<div className="flex items-center gap-2">
											<Input
												type="password"
												autoFocus
												value={draft.value}
												placeholder={`${provider.label} API key`}
												disabled={draft.saving}
												onChange={(event) =>
													setDraft(provider.id, {
														value: event.target.value,
														error: null,
													})
												}
												onKeyDown={(event) => {
													if (event.key === "Enter") void save(provider.id);
													if (event.key === "Escape") cancelEditor();
												}}
											/>
											<Button
												size="icon"
												type="button"
												className="size-9 shrink-0"
												aria-label="Save key"
												disabled={draft.saving}
												onClick={() => void save(provider.id)}
											>
												{draft.saving ? (
													<CircleNotch className="size-4 animate-spin" />
												) : (
													<Check className="size-4" />
												)}
											</Button>
											<Button
												variant="ghost"
												size="icon"
												type="button"
												className="size-9 shrink-0"
												aria-label="Cancel"
												disabled={draft.saving}
												onClick={cancelEditor}
											>
												<X className="size-4" />
											</Button>
										</div>
										{draft.error ? (
											<p className="text-xs text-destructive">{draft.error}</p>
										) : null}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
