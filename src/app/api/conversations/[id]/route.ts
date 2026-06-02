import { z } from "zod";
import { getDatabase } from "@/lib/ai/db/client";

type ConversationRow = {
	id: string;
	title: string;
	created_at: number;
	updated_at: number;
};

type MessageRow = {
	role: string;
	content: string;
	ordinal: number;
};

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	const db = getDatabase();

	const conversation = db
		.prepare(
			"SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?",
		)
		.get(id) as ConversationRow | undefined;

	if (!conversation) {
		return Response.json({ error: "Conversation not found" }, { status: 404 });
	}

	const messages = db
		.prepare(
			"SELECT role, content, ordinal FROM conversation_messages WHERE conversation_id = ? ORDER BY ordinal ASC",
		)
		.all(id) as MessageRow[];

	return Response.json({
		conversation: {
			id: conversation.id,
			title: conversation.title,
			createdAt: conversation.created_at,
			updatedAt: conversation.updated_at,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
		},
	});
}

const messageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
});

const putSchema = z.object({
	title: z.string().min(1).max(200).optional(),
	messages: z.array(messageSchema).max(1000).optional(),
});

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = putSchema.safeParse(raw);
	if (!parsed.success) {
		return Response.json(
			{ error: parsed.error.issues[0]?.message ?? "Invalid request" },
			{ status: 400 },
		);
	}

	const { title, messages } = parsed.data;
	if (!title && !messages) {
		return Response.json({ error: "Nothing to update" }, { status: 400 });
	}

	const db = getDatabase();
	const exists = db
		.prepare("SELECT 1 FROM conversations WHERE id = ?")
		.get(id) as { 1: number } | undefined;
	if (!exists) {
		return Response.json({ error: "Conversation not found" }, { status: 404 });
	}

	const now = Date.now();
	const update = db.transaction(() => {
		if (title) {
			db.prepare(
				"UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
			).run(title, now, id);
		} else {
			db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
				now,
				id,
			);
		}

		if (messages) {
			db.prepare(
				"DELETE FROM conversation_messages WHERE conversation_id = ?",
			).run(id);
			const msgStmt = db.prepare(
				"INSERT INTO conversation_messages (id, conversation_id, role, content, ordinal, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			);
			for (let i = 0; i < messages.length; i++) {
				const msg = messages[i];
				const msgId = `${id}-m${i}-${now}`;
				msgStmt.run(msgId, id, msg.role, msg.content, i, now + i);
			}
		}
	});

	update();

	return Response.json({ success: true });
}

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const { id } = await params;
	const db = getDatabase();

	const result = db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
	if (result.changes === 0) {
		return Response.json({ error: "Conversation not found" }, { status: 404 });
	}

	return Response.json({ success: true });
}
