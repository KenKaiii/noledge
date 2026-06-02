"use client";

import { Monitor, Moon, Plug, Settings, Sun, User, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { type Theme, useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { ProvidersSection } from "./providers-section";

type SettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "system", label: "System", icon: Monitor },
];

type Tab = "general" | "providers" | "account";

const TABS: { id: Tab; label: string; icon: typeof Settings }[] = [
	{ id: "general", label: "General", icon: Settings },
	{ id: "providers", label: "Providers", icon: Plug },
	{ id: "account", label: "Account", icon: User },
];

export function SettingsDialog({
	open,
	onOpenChange,
}: SettingsDialogProps): React.JSX.Element {
	const { theme, setTheme } = useTheme();
	const [activeTab, setActiveTab] = useState<Tab>("general");

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="h-[calc(100%-2rem)] max-h-[720px] w-[calc(100%-2rem)] max-w-4xl overflow-hidden border-0 p-0 sm:max-w-4xl"
			>
				<DialogTitle className="sr-only">Settings</DialogTitle>
				<DialogDescription className="sr-only">
					Manage your general, provider, and account settings.
				</DialogDescription>
				<div className="flex h-full">
					{/* Left sidebar */}
					<aside className="flex w-52 flex-col border-r">
						<div className="flex items-center justify-end p-4">
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								onClick={() => onOpenChange(false)}
								type="button"
							>
								<X className="size-4" />
								<span className="sr-only">Close</span>
							</Button>
						</div>
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
					<div className="flex flex-1 flex-col overflow-hidden">
						<div className="flex-1 overflow-y-auto">
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
									</div>
								</div>
							)}

							{activeTab === "providers" && (
								<div className="p-6">
									<h2 className="mb-6 text-lg font-semibold">Providers</h2>
									<ProvidersSection />
								</div>
							)}

							{activeTab === "account" && (
								<div className="p-6">
									<h2 className="mb-6 text-lg font-semibold">Account</h2>
									<div className="space-y-0">
										<div className="flex items-center justify-between py-4">
											<div className="space-y-0.5">
												<p className="text-sm font-medium">Email</p>
												<p className="text-xs text-muted-foreground">
													you@example.com
												</p>
											</div>
										</div>
										<Separator />
										<div className="flex items-center justify-between py-4">
											<div className="space-y-0.5">
												<p className="text-sm font-medium">Sign out</p>
												<p className="text-xs text-muted-foreground">
													Log out of your account.
												</p>
											</div>
											<Button variant="outline" size="sm" type="button">
												Sign out
											</Button>
										</div>
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
