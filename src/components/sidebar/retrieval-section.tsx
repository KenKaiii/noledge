"use client";

import { Check, CircleNotch, Trash, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notifyError, notifySuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

type RerankSettings = {
	enabled: boolean;
	hasKey: boolean;
	model: string;
};

export function RetrievalSection(): React.JSX.Element {
	const [settings, setSettings] = useState<RerankSettings | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [editingKey, setEditingKey] = useState(false);
	const [keyDraft, setKeyDraft] = useState("");

	useEffect(() => {
		let cancelled = false;
		async function load(): Promise<void> {
			try {
				const response = await fetch("/api/settings/rerank");
				const data = (await response.json()) as RerankSettings;
				if (!cancelled) setSettings(data);
			} catch (error) {
				if (!cancelled)
					notifyError(error, "Could not load retrieval settings.");
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	async function persist(
		patch: { enabled?: boolean; apiKey?: string | null },
		successMessage: string,
	): Promise<void> {
		setSaving(true);
		try {
			const response = await fetch("/api/settings/rerank", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});
			const data = (await response.json()) as RerankSettings & {
				error?: string;
			};
			if (!response.ok) {
				throw new Error(data.error ?? "Could not save retrieval settings.");
			}
			setSettings(data);
			notifySuccess(successMessage);
		} catch (error) {
			notifyError(error, "Could not save retrieval settings.");
		} finally {
			setSaving(false);
		}
	}

	async function saveKey(): Promise<void> {
		const apiKey = keyDraft.trim();
		if (apiKey.length === 0) {
			notifyError(null, "Enter a Cohere API key.");
			return;
		}
		await persist({ apiKey }, "Key saved.");
		setKeyDraft("");
		setEditingKey(false);
	}

	if (loading || !settings) {
		return (
			<div className="flex items-center justify-center py-6">
				<CircleNotch className="size-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-0">
			<div className="flex items-center justify-between gap-3 py-4">
				<div className="space-y-0.5">
					<p className="text-sm font-medium">Rerank retrieved passages</p>
					<p className="text-xs text-muted-foreground">
						Use a Cohere cross-encoder to reorder candidates so the most
						relevant passages reach the model. Requires a Cohere API key.
					</p>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={settings.enabled}
					aria-label="Rerank retrieved passages"
					disabled={saving}
					onClick={() =>
						void persist(
							{ enabled: !settings.enabled },
							settings.enabled ? "Reranking disabled." : "Reranking enabled.",
						)
					}
					className={cn(
						"relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
						settings.enabled ? "bg-primary" : "bg-muted-foreground/30",
						saving && "opacity-60",
					)}
				>
					<span
						className={cn(
							"inline-block size-4 transform rounded-full bg-background shadow transition-transform",
							settings.enabled ? "translate-x-6" : "translate-x-1",
						)}
					/>
				</button>
			</div>

			<div className="space-y-2 py-4">
				<div className="space-y-0.5">
					<p className="text-sm font-medium">Cohere API key</p>
					{settings.hasKey && !editingKey ? (
						<p className="text-xs text-muted-foreground">
							A key is saved. Model: {settings.model}
						</p>
					) : (
						<a
							href="https://dashboard.cohere.com/api-keys"
							target="_blank"
							rel="noreferrer"
							className="block truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
						>
							Get a Cohere API key
						</a>
					)}
				</div>

				{editingKey || !settings.hasKey ? (
					<div className="flex items-center gap-2">
						<Input
							type="password"
							autoFocus={editingKey}
							value={keyDraft}
							placeholder="Cohere API key"
							disabled={saving}
							onChange={(event) => setKeyDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void saveKey();
								if (event.key === "Escape") {
									setEditingKey(false);
									setKeyDraft("");
								}
							}}
						/>
						<Button
							size="icon"
							type="button"
							className="size-9 shrink-0"
							aria-label="Save key"
							disabled={saving}
							onClick={() => void saveKey()}
						>
							{saving ? (
								<CircleNotch className="size-4 animate-spin" />
							) : (
								<Check className="size-4" />
							)}
						</Button>
						{settings.hasKey ? (
							<Button
								variant="ghost"
								size="icon"
								type="button"
								className="size-9 shrink-0"
								aria-label="Cancel"
								disabled={saving}
								onClick={() => {
									setEditingKey(false);
									setKeyDraft("");
								}}
							>
								<X className="size-4" />
							</Button>
						) : null}
					</div>
				) : (
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							type="button"
							onClick={() => setEditingKey(true)}
						>
							Replace key
						</Button>
						<Button
							variant="ghost"
							size="sm"
							type="button"
							disabled={saving}
							onClick={() => void persist({ apiKey: null }, "Key removed.")}
						>
							<Trash className="size-3.5" />
							Remove
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
