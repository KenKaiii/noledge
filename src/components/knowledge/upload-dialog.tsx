"use client";

import { CheckCircle2, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { UPLOAD_ACCEPT } from "@/components/chat/chat-input-bar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type PendingStatus = "pending" | "uploading" | "done" | "error";

type PendingFile = {
	id: string;
	file: File;
	status: PendingStatus;
	error?: string;
};

type UploadDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called after at least one file uploaded successfully. */
	onUploaded: () => void;
};

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDialog({
	open,
	onOpenChange,
	onUploaded,
}: UploadDialogProps): React.JSX.Element {
	const [files, setFiles] = useState<PendingFile[]>([]);
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const seq = useRef(0);

	const addFiles = useCallback((list: FileList | File[]): void => {
		const next: PendingFile[] = Array.from(list).map((file) => ({
			id: `f-${seq.current++}`,
			file,
			status: "pending",
		}));
		setFiles((prev) => [...prev, ...next]);
	}, []);

	const removeFile = useCallback((id: string): void => {
		setFiles((prev) => prev.filter((item) => item.id !== id));
	}, []);

	const setStatus = useCallback(
		(id: string, patch: Partial<PendingFile>): void => {
			setFiles((prev) =>
				prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
			);
		},
		[],
	);

	const reset = useCallback((): void => {
		setFiles([]);
		setDragging(false);
		seq.current = 0;
	}, []);

	const handleOpenChange = useCallback(
		(value: boolean): void => {
			if (busy) return; // don't allow closing mid-upload
			if (!value) reset();
			onOpenChange(value);
		},
		[busy, onOpenChange, reset],
	);

	const upload = useCallback(async (): Promise<void> => {
		const queue = files.filter((item) => item.status !== "done");
		if (queue.length === 0) return;

		setBusy(true);
		let anyOk = false;

		for (const item of queue) {
			setStatus(item.id, { status: "uploading", error: undefined });
			const form = new FormData();
			form.append("file", item.file);
			try {
				const response = await fetch("/api/documents", {
					method: "POST",
					body: form,
				});
				if (response.ok) {
					anyOk = true;
					setStatus(item.id, { status: "done" });
				} else {
					const data = (await response.json()) as { error?: string };
					setStatus(item.id, { status: "error", error: data.error });
				}
			} catch (error) {
				setStatus(item.id, {
					status: "error",
					error: error instanceof Error ? error.message : "Upload failed",
				});
			}
		}

		setBusy(false);
		if (anyOk) onUploaded();
	}, [files, onUploaded, setStatus]);

	const allDone =
		files.length > 0 && files.every((item) => item.status === "done");
	const pendingCount = files.filter((item) => item.status !== "done").length;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent showCloseButton={!busy} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Upload to knowledge base</DialogTitle>
					<DialogDescription>
						PDF, Office, text, and images (OCR). Files are chunked and embedded
						for retrieval.
					</DialogDescription>
				</DialogHeader>

				<input
					ref={inputRef}
					type="file"
					multiple
					accept={UPLOAD_ACCEPT}
					className="hidden"
					onChange={(event) => {
						if (event.target.files?.length) addFiles(event.target.files);
						event.target.value = "";
					}}
				/>

				<button
					type="button"
					onClick={() => inputRef.current?.click()}
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(event) => {
						event.preventDefault();
						setDragging(false);
						if (event.dataTransfer.files.length)
							addFiles(event.dataTransfer.files);
					}}
					className={cn(
						"flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
						dragging
							? "border-primary bg-accent/50"
							: "border-border hover:bg-accent/50",
					)}
				>
					<UploadCloud className="size-7 text-muted-foreground" />
					<span className="text-sm font-medium">
						Drag files here or click to browse
					</span>
					<span className="text-xs text-muted-foreground">
						You can add multiple files
					</span>
				</button>

				{files.length > 0 ? (
					<ul className="flex max-h-56 flex-col divide-y overflow-y-auto">
						{files.map((item) => (
							<li
								key={item.id}
								className="flex items-center gap-3 py-3 text-sm"
							>
								{item.status === "uploading" ? (
									<Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
								) : item.status === "done" ? (
									<CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
								) : (
									<FileText
										className={cn(
											"size-4 shrink-0",
											item.status === "error"
												? "text-destructive"
												: "text-muted-foreground",
										)}
									/>
								)}
								<div className="min-w-0 flex-1">
									<p className="truncate">{item.file.name}</p>
									{item.status === "error" ? (
										<p className="truncate text-xs text-destructive">
											{item.error ?? "Failed"}
										</p>
									) : (
										<p className="text-xs text-muted-foreground">
											{formatBytes(item.file.size)}
										</p>
									)}
								</div>
								{item.status === "pending" && !busy ? (
									<button
										type="button"
										onClick={() => removeFile(item.id)}
										aria-label={`Remove ${item.file.name}`}
										className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
									>
										<X className="size-3.5" />
									</button>
								) : null}
							</li>
						))}
					</ul>
				) : null}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => handleOpenChange(false)}
						disabled={busy}
					>
						{allDone ? "Done" : "Cancel"}
					</Button>
					<Button
						onClick={() => void upload()}
						disabled={busy || pendingCount === 0}
					>
						{busy ? (
							<>
								<Loader2 className="size-4 animate-spin" />
								Uploading…
							</>
						) : (
							`Upload${pendingCount > 0 ? ` ${pendingCount}` : ""}`
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
