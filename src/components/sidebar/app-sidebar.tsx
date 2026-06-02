"use client";

import { MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { NAV_ITEMS } from "./nav-data";
import { SettingsDialog } from "./settings-dialog";

type Conversation = {
	id: string;
	title: string;
	updatedAt: number;
};

export function AppSidebar(): React.JSX.Element {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const activeChatId = searchParams.get("chat");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async (): Promise<void> => {
		try {
			const response = await fetch("/api/conversations");
			const data = (await response.json()) as {
				conversations: Conversation[];
			};
			setConversations(data.conversations);
		} catch {
			setConversations([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		const handler = (): void => {
			void load();
		};
		window.addEventListener("conversations:changed", handler);
		return () => {
			window.removeEventListener("conversations:changed", handler);
		};
	}, [load]);

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<div className="flex items-center justify-between gap-2">
					<span className="px-1 text-base font-semibold group-data-[collapsible=icon]:hidden">
						noledge
					</span>
					<SidebarTrigger />
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{NAV_ITEMS.map((item) => (
								<SidebarMenuItem key={item.href}>
									<SidebarMenuButton
										asChild
										isActive={pathname === item.href && !activeChatId}
										tooltip={item.title}
									>
										<Link href={item.href}>
											<item.icon />
											<span>{item.title}</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
				<SidebarGroup className="group-data-[collapsible=icon]:hidden">
					<div className="flex items-center justify-between pr-2">
						<SidebarGroupLabel className="m-0">Chats</SidebarGroupLabel>
						<Link
							href="/"
							className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label="New chat"
							title="New chat"
						>
							<Plus className="size-3.5" />
						</Link>
					</div>
					<SidebarGroupContent>
						<SidebarMenu>
							{loading ? (
								<SidebarMenuItem>
									<SidebarMenuButton disabled>
										<span className="text-xs text-muted-foreground">
											Loading…
										</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							) : conversations.length === 0 ? (
								<SidebarMenuItem>
									<SidebarMenuButton disabled>
										<span className="text-xs text-muted-foreground">
											No chats yet
										</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							) : (
								conversations.map((session) => (
									<SidebarMenuItem key={session.id}>
										<SidebarMenuButton
											asChild
											isActive={activeChatId === session.id}
											tooltip={session.title}
										>
											<Link href={`/?chat=${session.id}`}>
												<MessageSquare className="size-4" />
												<span className="truncate">{session.title}</span>
											</Link>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))
							)}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							data-settings-trigger
							size="lg"
							tooltip="Settings"
							onClick={() => setSettingsOpen(true)}
						>
							<Avatar className="size-7">
								<AvatarFallback>U</AvatarFallback>
							</Avatar>
							<div className="flex flex-col text-left leading-tight">
								<span className="text-sm font-medium">User</span>
								<span className="text-xs text-muted-foreground">
									you@example.com
								</span>
							</div>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
		</Sidebar>
	);
}
