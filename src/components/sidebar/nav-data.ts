import { BookOpen, Brain, type LucideIcon, MessageSquare } from "lucide-react";

export type NavItem = {
	readonly title: string;
	readonly href: string;
	readonly icon: LucideIcon;
};

export const NAV_ITEMS: readonly NavItem[] = [
	{ title: "Chat", href: "/", icon: MessageSquare },
	{ title: "Knowledge", href: "/knowledge", icon: BookOpen },
	{ title: "The Brain", href: "/brain", icon: Brain },
];
