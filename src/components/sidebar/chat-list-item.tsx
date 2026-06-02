"use client";

import { MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

export type ChatListItemData = {
	id: string;
	title: string;
};

type ChatListItemProps = {
	chat: ChatListItemData;
	isActive: boolean;
	onRenamed: (id: string, title: string) => void;
	onDeleted: (id: string) => void;
};

export function ChatListItem({
	chat,
	isActive,
	onRenamed,
	onDeleted,
}: ChatListItemProps): React.JSX.Element {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(chat.title);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);

	function beginEdit(): void {
		setDraft(chat.title);
		setEditing(true);
	}

	async function commitEdit(): Promise<void> {
		const next = draft.trim();
		setEditing(false);
		if (next.length === 0 || next === chat.title) return;
		// Optimistic: update UI first, revert handled by reload on failure.
		onRenamed(chat.id, next);
		try {
			await fetch(`/api/conversations/${chat.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: next }),
			});
		} catch {
			/* sidebar reload will resync on next event */
		}
	}

	async function confirmDelete(): Promise<void> {
		setDeleting(true);
		try {
			await fetch(`/api/conversations/${chat.id}`, { method: "DELETE" });
			onDeleted(chat.id);
		} catch {
			/* leave dialog open on failure */
		} finally {
			setDeleting(false);
			setConfirmOpen(false);
		}
	}

	return (
		<SidebarMenuItem>
			{editing ? (
				<div className="px-2 py-1">
					<Input
						value={draft}
						autoFocus
						onChange={(event) => setDraft(event.target.value)}
						onBlur={() => void commitEdit()}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void commitEdit();
							} else if (event.key === "Escape") {
								event.preventDefault();
								setEditing(false);
							}
						}}
						className="h-7 text-sm"
						aria-label="Rename chat"
					/>
				</div>
			) : (
				<>
					<SidebarMenuButton asChild isActive={isActive} tooltip={chat.title}>
						<Link
							href={`/?chat=${chat.id}`}
							onDoubleClick={(event) => {
								event.preventDefault();
								beginEdit();
							}}
						>
							<MessageSquare className="size-4" />
							<span className="truncate">{chat.title}</span>
						</Link>
					</SidebarMenuButton>
					<SidebarMenuAction
						showOnHover
						onClick={(event) => {
							event.preventDefault();
							setConfirmOpen(true);
						}}
						aria-label="Delete chat"
						title="Delete chat"
					>
						<Trash2 className="size-4" />
					</SidebarMenuAction>
				</>
			)}

			<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete chat?</DialogTitle>
						<DialogDescription>
							This permanently deletes “{chat.title}” and all its messages. This
							cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setConfirmOpen(false)}
							disabled={deleting}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => void confirmDelete()}
							disabled={deleting}
						>
							{deleting ? "Deleting…" : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</SidebarMenuItem>
	);
}
