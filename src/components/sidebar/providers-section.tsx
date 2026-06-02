"use client";

import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ProviderStatus = {
	id: string;
	label: string;
	hint: string;
	envVar: string;
	connected: boolean;
	source: "system" | "local" | "none";
	maskedKey: string | null;
};

type DraftState = {
	value: string;
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
				Connect API keys to enable models. Keys are stored locally on this
				device.
			</p>

			{loading ? (
				<div className="flex items-center justify-center py-6">
					<Loader2 className="size-5 animate-spin text-muted-foreground" />
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
															provider.source === "system"
																? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
																: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
														)}
													>
														{provider.source === "system"
															? "System"
															: "Connected"}
													</span>
												) : null}
											</div>
											<p className="truncate text-xs text-muted-foreground">
												{provider.connected && provider.maskedKey
													? provider.maskedKey
													: provider.hint}
											</p>
										</div>
									</div>

									{!isEditing ? (
										<div className="flex shrink-0 items-center gap-1">
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
														<Loader2 className="size-4 animate-spin" />
													) : (
														<Trash2 className="size-4" />
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

								{isEditing ? (
									<div className="mt-2.5 space-y-2">
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
													<Loader2 className="size-4 animate-spin" />
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
										) : (
											<p className="text-xs text-muted-foreground">
												Validated against the provider before saving.
											</p>
										)}
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
