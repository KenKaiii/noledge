import { z } from "zod";
import { getDatabase } from "@/lib/ai/db/client";

type ConversationRow = {
	id: string;
	title: string;
	created_at: number;
	updated_at: number;
};

export async function GET(): Promise<Response> {
	const db = getDatabase();
	const rows = db
		.prepare(
			"SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 100",
		)
		.all() as ConversationRow[];

	return Response.json({
		conversations: rows.map((row) => ({
			id: row.id,
			title: row.title,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		})),
	});
}

const messageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string(),
});

const postSchema = z.object({
	title: z.string().min(1).max(200),
	messages: z.array(messageSchema).max(1000),
});

export async function POST(request: Request): Promise<Response> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = postSchema.safeParse(raw);
	if (!parsed.success) {
		return Response.json(
			{ error: parsed.error.issues[0]?.message ?? "Invalid request" },
			{ status: 400 },
		);
	}

	const { title, messages } = parsed.data;
	const now = Date.now();
	const id = `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

	const db = getDatabase();
	const insert = db.transaction((conversationId: string) => {
		db.prepare(
			"INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
		).run(conversationId, title, now, now);

		const msgStmt = db.prepare(
			"INSERT INTO conversation_messages (id, conversation_id, role, content, ordinal, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		);
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			const msgId = `${conversationId}-m${i}`;
			msgStmt.run(msgId, conversationId, msg.role, msg.content, i, now + i);
		}
	});

	insert(id);

	return Response.json({ id }, { status: 201 });
}
