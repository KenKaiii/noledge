"use client";

import {
	CaretDown,
	Gear,
	Monitor,
	Moon,
	Plug,
	Robot,
	Sun,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { usePromptSuggestions } from "@/hooks/use-prompt-suggestions";
import { type Theme, useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { ProvidersSection } from "./providers-section";

export type SettingsTab = "general" | "providers" | "agent";

type SettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialTab?: SettingsTab;
};

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "system", label: "System", icon: Monitor },
];

const TABS: { id: SettingsTab; label: string; icon: typeof Gear }[] = [
	{ id: "general", label: "General", icon: Gear },
	{ id: "providers", label: "Providers", icon: Plug },
	{ id: "agent", label: "Agent", icon: Robot },
];

const RESPONSE_STYLE_OPTIONS = [
	{ value: "default", label: "Default" },
	{ value: "no-bullshit-to-the-point", label: "No bullsh*t, to the point" },
	{ value: "easy-explainer", label: "Easy explainer" },
] as const;

type ResponseStyleValue = (typeof RESPONSE_STYLE_OPTIONS)[number]["value"];

type LegacyResponseStyleValue =
	| ResponseStyleValue
	| "no-bullshit"
	| "to-the-point";

function normalizeResponseStyle(
	value: LegacyResponseStyleValue | undefined,
): ResponseStyleValue {
	if (value === "no-bullshit" || value === "to-the-point") {
		return "no-bullshit-to-the-point";
	}
	return value ?? "default";
}

export function SettingsDialog({
	open,
	onOpenChange,
	initialTab = "general",
}: SettingsDialogProps): React.JSX.Element {
	const { theme, setTheme } = useTheme();
	const { suggestions, setSuggestions, resetSuggestions } =
		usePromptSuggestions();
	const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
	const [suggestionsText, setSuggestionsText] = useState(() =>
		suggestions.join("\n"),
	);
	const [agentPrompt, setAgentPrompt] = useState("");
	const [defaultAgentPrompt, setDefaultAgentPrompt] = useState("");
	const [aboutUser, setAboutUser] = useState("");
	const [responseStyle, setResponseStyle] =
		useState<ResponseStyleValue>("default");
	const [agentSaving, setAgentSaving] = useState(false);
	const [agentError, setAgentError] = useState<string | null>(null);
	const [agentSaved, setAgentSaved] = useState(false);

	// Honor the requested tab each time the dialog is opened.
	useEffect(() => {
		if (open) setActiveTab(initialTab);
	}, [open, initialTab]);

	useEffect(() => {
		if (open) setSuggestionsText(suggestions.join("\n"));
	}, [open, suggestions]);

	useEffect(() => {
		if (!open) return;

		let cancelled = false;
		async function loadAgentPrompt(): Promise<void> {
			setAgentError(null);
			try {
				const response = await fetch("/api/settings/agent");
				const data = (await response.json()) as {
					systemPrompt?: string;
					defaultSystemPrompt?: string;
					aboutUser?: string;
					responseStyle?: LegacyResponseStyleValue;
					error?: string;
				};
				if (!response.ok)
					throw new Error(data.error ?? "Could not load prompt.");
				if (!cancelled) {
					setAgentPrompt(data.systemPrompt ?? "");
					setDefaultAgentPrompt(data.defaultSystemPrompt ?? "");
					setAboutUser(data.aboutUser ?? "");
					setResponseStyle(normalizeResponseStyle(data.responseStyle));
					setAgentSaved(false);
				}
			} catch (error) {
				if (!cancelled) {
					setAgentError(
						error instanceof Error ? error.message : "Could not load prompt.",
					);
				}
			}
		}

		void loadAgentPrompt();
		return () => {
			cancelled = true;
		};
	}, [open]);

	async function saveAgentSettings(nextPrompt: string | null): Promise<void> {
		setAgentSaving(true);
		setAgentError(null);
		setAgentSaved(false);
		try {
			const response = await fetch("/api/settings/agent", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					systemPrompt: nextPrompt,
					aboutUser,
					responseStyle,
				}),
			});
			const data = (await response.json()) as {
				systemPrompt?: string;
				defaultSystemPrompt?: string;
				aboutUser?: string;
				responseStyle?: LegacyResponseStyleValue;
				error?: string;
			};
			if (!response.ok)
				throw new Error(data.error ?? "Could not save settings.");
			setAgentPrompt(data.systemPrompt ?? "");
			setDefaultAgentPrompt(data.defaultSystemPrompt ?? "");
			setAboutUser(data.aboutUser ?? "");
			setResponseStyle(normalizeResponseStyle(data.responseStyle));
			setAgentSaved(true);
		} catch (error) {
			setAgentError(
				error instanceof Error ? error.message : "Could not save settings.",
			);
		} finally {
			setAgentSaving(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="h-[calc(100%-2rem)] max-h-[720px] w-[calc(100%-2rem)] max-w-4xl overflow-hidden border-0 p-0 sm:max-w-4xl">
				<DialogTitle className="sr-only">Settings</DialogTitle>
				<DialogDescription className="sr-only">
					Manage your general, provider, and agent settings.
				</DialogDescription>
				<div className="flex h-full min-h-0">
					{/* Left sidebar */}
					<aside className="flex w-52 flex-col border-r py-4">
						<nav className="flex flex-1 flex-col gap-1 px-3">
							{TABS.map((tab) => (
								<button
									key={tab.id}
									type="button"
									onClick={() => setActiveTab(tab.id)}
									className={cn(
										"flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
										activeTab === tab.id
											? "bg-muted text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<tab.icon className="size-4" />
									{tab.label}
								</button>
							))}
						</nav>
					</aside>

					{/* Right panel */}
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
							{activeTab === "general" && (
								<div className="p-6">
									<h2 className="mb-6 text-lg font-semibold">General</h2>
									<div className="space-y-0">
										<div className="flex items-center justify-between py-4">
											<div className="space-y-0.5">
												<p className="text-sm font-medium">Appearance</p>
												<p className="text-xs text-muted-foreground">
													Choose how noledge looks to you.
												</p>
											</div>
											<div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
												{THEME_OPTIONS.map((option) => (
													<button
														key={option.value}
														type="button"
														onClick={() => setTheme(option.value)}
														aria-pressed={theme === option.value}
														className={cn(
															"flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors",
															theme === option.value
																? "bg-background text-foreground shadow-xs"
																: "text-muted-foreground hover:text-foreground",
														)}
													>
														<option.icon className="size-4" />
														{option.label}
													</button>
												))}
											</div>
										</div>
										<Separator />
										<div className="space-y-3 py-4">
											<div className="space-y-0.5">
												<p className="text-sm font-medium">
													Prompt suggestions
												</p>
												<p className="text-xs text-muted-foreground">
													Edit the quick prompts shown around the chat input.
													Add one prompt per line.
												</p>
											</div>
											<Textarea
												value={suggestionsText}
												onChange={(event) =>
													setSuggestionsText(event.target.value)
												}
												className="min-h-28 resize-y text-sm"
												placeholder="What new information is in my brain from today?"
											/>
											<div className="flex justify-end gap-2">
												<Button
													variant="outline"
													size="sm"
													type="button"
													onClick={() => {
														resetSuggestions();
													}}
												>
													Reset
												</Button>
												<Button
													size="sm"
													type="button"
													onClick={() => {
														setSuggestions(suggestionsText.split("\n"));
													}}
												>
													Save suggestions
												</Button>
											</div>
										</div>
										<Separator />
									</div>
								</div>
							)}

							{activeTab === "providers" && (
								<div className="p-6">
									<h2 className="mb-6 text-lg font-semibold">Providers</h2>
									<ProvidersSection />
								</div>
							)}

							{activeTab === "agent" && (
								<div className="p-6">
									<h2 className="mb-6 text-lg font-semibold">Agent</h2>
									<div className="space-y-4">
										<div className="space-y-1">
											<p className="text-sm font-medium">Main system prompt</p>
											<p className="text-xs text-muted-foreground">
												Adjust the stable system instructions used for new agent
												responses.
											</p>
										</div>
										<Textarea
											value={agentPrompt}
											onChange={(event) => {
												setAgentPrompt(event.target.value);
												setAgentSaved(false);
												setAgentError(null);
											}}
											className="min-h-[280px] resize-y font-mono text-xs leading-relaxed"
											placeholder="You are noledge..."
										/>

										<Separator />

										<div className="space-y-2">
											<div className="space-y-1">
												<p className="text-sm font-medium">About you</p>
												<p className="text-xs text-muted-foreground">
													Optional context that helps the agent tailor responses
													to you.
												</p>
											</div>
											<Textarea
												value={aboutUser}
												onChange={(event) => {
													setAboutUser(event.target.value);
													setAgentSaved(false);
													setAgentError(null);
												}}
												className="min-h-28 resize-y text-sm"
												placeholder={[
													"- I work as a product designer",
													"- I am learning TypeScript and AI tooling",
													"- I am based in Singapore",
												].join("\n")}
											/>
										</div>

										<div className="space-y-2">
											<div className="space-y-1">
												<p className="text-sm font-medium">Response style</p>
												<p className="text-xs text-muted-foreground">
													Adjust how direct, brief, or explanatory responses
													should be.
												</p>
											</div>
											<div className="relative">
												<select
													value={responseStyle}
													onChange={(event) => {
														setResponseStyle(
															event.target.value as ResponseStyleValue,
														);
														setAgentSaved(false);
														setAgentError(null);
													}}
													className="h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
												>
													{RESPONSE_STYLE_OPTIONS.map((option) => (
														<option key={option.value} value={option.value}>
															{option.label}
														</option>
													))}
												</select>
												<CaretDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
											</div>
										</div>
										<div className="flex items-center justify-between gap-3">
											<div className="min-h-4 text-xs">
												{agentError ? (
													<span className="text-destructive">{agentError}</span>
												) : agentSaved ? (
													<span className="text-emerald-600 dark:text-emerald-400">
														Saved. Future responses will use these settings.
													</span>
												) : null}
											</div>
											<div className="flex justify-end gap-2">
												<Button
													variant="outline"
													size="sm"
													type="button"
													disabled={agentSaving}
													onClick={() => void saveAgentSettings(null)}
												>
													Reset default
												</Button>
												<Button
													size="sm"
													type="button"
													disabled={
														agentSaving || agentPrompt.trim().length === 0
													}
													onClick={() => void saveAgentSettings(agentPrompt)}
												>
													Save settings
												</Button>
											</div>
										</div>
										{defaultAgentPrompt &&
										agentPrompt !== defaultAgentPrompt ? (
											<p className="text-xs text-muted-foreground">
												This prompt differs from the noledge default.
											</p>
										) : null}
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
