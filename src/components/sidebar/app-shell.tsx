"use client";

import { Suspense } from "react";

import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";

export function AppShell({
	children,
}: {
	children: React.ReactNode;
}): React.JSX.Element {
	return (
		<SidebarProvider>
			<Suspense fallback={null}>
				<AppSidebar />
			</Suspense>
			<SidebarInset className="h-svh min-w-0">
				<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
					<SidebarTrigger />
					<span className="text-sm font-semibold">noledge</span>
				</header>
				<div className="min-h-0 flex-1">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
