import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/ai/db/client";
import { listRecentDocuments } from "./tools";

describe("listRecentDocuments", () => {
	it("treats a date-only upper bound as the full day", () => {
		const db = openDatabase(":memory:");
		try {
			const insert = db.prepare(
				`INSERT INTO documents (id, title, filename, mime, bytes, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			);
			insert.run(
				"early",
				"Early document",
				"early.txt",
				"text/plain",
				1,
				Date.parse("2026-06-04T00:00:00.000Z"),
			);
			insert.run(
				"late",
				"Late document",
				"late.txt",
				"text/plain",
				1,
				Date.parse("2026-06-04T23:59:59.000Z"),
			);
			insert.run(
				"next",
				"Next day document",
				"next.txt",
				"text/plain",
				1,
				Date.parse("2026-06-05T00:00:00.000Z"),
			);

			const result = listRecentDocuments("2026-06-04", "2026-06-04", 10, db);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.documents.map((document) => document.id)).toEqual([
				"late",
				"early",
			]);
		} finally {
			db.close();
		}
	});
});
