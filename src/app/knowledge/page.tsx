"use client";

import type { LucideIcon } from "lucide-react";
import {
	FileImage,
	FileSpreadsheet,
	FileText,
	FileType,
	Loader2,
	Trash2,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { UploadDialog } from "@/components/knowledge/upload-dialog";
import { Button } from "@/components/ui/button";

type DocumentItem = {
	id: string;
	title: string;
	filename: string;
	mime: string;
	bytes: number;
	createdAt: number;
	chunks: number;
};

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
	return new Date(ms).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function extensionOf(filename: string): string {
	const dot = filename.lastIndexOf(".");
	return dot === -1 ? "" : filename.slice(dot + 1).toUpperCase();
}

function iconFor(mime: string, filename: string): LucideIcon {
	const ext = filename.toLowerCase().split(".").pop() ?? "";
	if (mime.startsWith("image/")) return FileImage;
	if (["xlsx", "ods", "csv"].includes(ext)) return FileSpreadsheet;
	if (mime === "application/pdf" || ext === "pdf") return FileType;
	return FileText;
}

export default function KnowledgePage(): React.JSX.Element {
	const [documents, setDocuments] = useState<DocumentItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [uploadOpen, setUploadOpen] = useState(false);

	const load = useCallback(async (): Promise<void> => {
		try {
			const response = await fetch("/api/documents");
			const data = (await response.json()) as { documents: DocumentItem[] };
			setDocuments(data.documents);
		} catch {
			setDocuments([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const remove = useCallback(async (id: string): Promise<void> => {
		setDeleting(id);
		try {
			await fetch(`/api/documents?id=${encodeURIComponent(id)}`, {
				method: "DELETE",
			});
			setDocuments((prev) => prev.filter((doc) => doc.id !== id));
		} finally {
			setDeleting(null);
		}
	}, []);

	const isEmpty = !loading && documents.length === 0;

	return (
		<div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-6 py-8">
			<div className="flex items-end justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
					<p className="text-sm text-muted-foreground">
						Documents you have taught noledge.
					</p>
				</div>
				<Button onClick={() => setUploadOpen(true)} className="shrink-0">
					<Upload className="size-4" />
					Upload
				</Button>
			</div>

			{loading ? (
				<div className="flex flex-1 items-center justify-center">
					<Loader2 className="size-6 animate-spin text-muted-foreground" />
				</div>
			) : isEmpty ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center">
					<p className="text-sm font-medium">No knowledge yet</p>
					<p className="text-xs text-muted-foreground">
						Upload documents — PDF, Office, text, and images (OCR)
					</p>
				</div>
			) : (
				<div className="overflow-hidden rounded-xl border">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
								<th className="px-4 py-2.5 font-medium">Name</th>
								<th className="px-4 py-2.5 font-medium">Type</th>
								<th className="px-4 py-2.5 text-right font-medium">Chunks</th>
								<th className="px-4 py-2.5 text-right font-medium">Size</th>
								<th className="px-4 py-2.5 font-medium">Added</th>
								<th className="w-12 px-4 py-2.5" />
							</tr>
						</thead>
						<tbody>
							{documents.map((doc) => {
								const Icon = iconFor(doc.mime, doc.filename);
								return (
									<tr
										key={doc.id}
										className="group border-b last:border-0 transition-colors hover:bg-accent/40"
									>
										<td className="px-4 py-3">
											<div className="flex items-center gap-3">
												<Icon className="size-5 shrink-0 text-muted-foreground" />
												<div className="min-w-0">
													<p className="truncate font-medium">{doc.title}</p>
													<p className="truncate text-xs text-muted-foreground">
														{doc.filename}
													</p>
												</div>
											</div>
										</td>
										<td className="px-4 py-3 text-muted-foreground">
											{extensionOf(doc.filename) || "—"}
										</td>
										<td className="px-4 py-3 text-right tabular-nums">
											{doc.chunks}
										</td>
										<td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
											{formatBytes(doc.bytes)}
										</td>
										<td className="px-4 py-3 text-muted-foreground">
											{formatDate(doc.createdAt)}
										</td>
										<td className="px-4 py-3 text-right">
											<Button
												variant="ghost"
												size="icon"
												type="button"
												className="size-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
												aria-label={`Delete ${doc.title}`}
												disabled={deleting === doc.id}
												onClick={() => {
													void remove(doc.id);
												}}
											>
												{deleting === doc.id ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													<Trash2 className="size-4" />
												)}
											</Button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			<UploadDialog
				open={uploadOpen}
				onOpenChange={setUploadOpen}
				onUploaded={() => void load()}
			/>
		</div>
	);
}
