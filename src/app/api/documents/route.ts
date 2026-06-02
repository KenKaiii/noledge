import { getDatabase } from "@/lib/ai/db/client";
import { ingestDocument } from "@/lib/ai/rag/ingest";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per upload.

type DocumentRow = {
	id: string;
	title: string;
	filename: string;
	mime: string;
	bytes: number;
	created_at: number;
};

export async function POST(request: Request): Promise<Response> {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return Response.json(
			{ error: "Expected multipart/form-data" },
			{ status: 400 },
		);
	}

	const file = form.get("file");
	if (!(file instanceof File)) {
		return Response.json(
			{ error: "Missing `file` in form data" },
			{ status: 400 },
		);
	}

	if (file.size > MAX_BYTES) {
		return Response.json(
			{ error: `File exceeds ${MAX_BYTES} byte limit` },
			{ status: 413 },
		);
	}

	const data = Buffer.from(await file.arrayBuffer());
	const titleField = form.get("title");
	const title = typeof titleField === "string" ? titleField : undefined;

	const result = await ingestDocument(
		{
			data,
			filename: file.name,
			mime: file.type || "application/octet-stream",
			title,
		},
		{ signal: request.signal },
	);

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: 422 });
	}

	return Response.json({
		documentId: result.documentId,
		chunks: result.chunks,
	});
}

export async function GET(): Promise<Response> {
	const db = getDatabase();
	const rows = db
		.prepare(
			"SELECT id, title, filename, mime, bytes, created_at FROM documents ORDER BY created_at DESC",
		)
		.all() as DocumentRow[];

	const documents = rows.map((row) => ({
		id: row.id,
		title: row.title,
		filename: row.filename,
		mime: row.mime,
		bytes: row.bytes,
		createdAt: row.created_at,
		chunks: (
			db
				.prepare("SELECT COUNT(*) AS count FROM chunks WHERE document_id = ?")
				.get(row.id) as { count: number }
		).count,
	}));

	return Response.json({ documents });
}

export async function DELETE(request: Request): Promise<Response> {
	const id = new URL(request.url).searchParams.get("id");
	if (!id) {
		return Response.json(
			{ error: "Missing `id` query param" },
			{ status: 400 },
		);
	}

	const db = getDatabase();
	const remove = db.transaction((documentId: string) => {
		const chunkIds = db
			.prepare("SELECT id FROM chunks WHERE document_id = ?")
			.all(documentId) as { id: string }[];
		const deleteVec = db.prepare("DELETE FROM vec_chunks WHERE chunk_id = ?");
		for (const chunk of chunkIds) deleteVec.run(chunk.id);
		// `chunks` cascade-deletes via the FK, but delete explicitly to be safe.
		db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
		const info = db
			.prepare("DELETE FROM documents WHERE id = ?")
			.run(documentId);
		return info.changes;
	});

	const changes = remove(id);
	if (changes === 0) {
		return Response.json({ error: "Document not found" }, { status: 404 });
	}

	return Response.json({ deleted: id });
}
