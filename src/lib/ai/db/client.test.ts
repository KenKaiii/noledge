import { describe, expect, it } from "vitest";
import { openDatabase } from "./client";

function f32(values: number[]): Buffer {
	return Buffer.from(new Float32Array(values).buffer);
}

describe("openDatabase", () => {
	it("loads sqlite-vec and exposes vec_version()", () => {
		const db = openDatabase(":memory:");
		try {
			const row = db.prepare("SELECT vec_version() AS version").get() as {
				version: string;
			};
			expect(typeof row.version).toBe("string");
			expect(row.version.length).toBeGreaterThan(0);
		} finally {
			db.close();
		}
	});

	it("creates the schema tables", () => {
		const db = openDatabase(":memory:");
		try {
			const names = db
				.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')")
				.all() as { name: string }[];
			const set = new Set(names.map((n) => n.name));
			expect(set.has("documents")).toBe(true);
			expect(set.has("chunks")).toBe(true);
			expect(set.has("vec_chunks")).toBe(true);
		} finally {
			db.close();
		}
	});

	it("returns the nearest neighbour from a vec0 KNN query", () => {
		const db = openDatabase(":memory:");
		try {
			db.exec(
				"CREATE VIRTUAL TABLE t USING vec0(id TEXT PRIMARY KEY, embedding float[4])",
			);
			const insert = db.prepare("INSERT INTO t(id, embedding) VALUES (?, ?)");
			insert.run("a", f32([1, 0, 0, 0]));
			insert.run("b", f32([0, 1, 0, 0]));
			insert.run("c", f32([0, 0, 1, 0]));

			const rows = db
				.prepare(
					"SELECT id, distance FROM t WHERE embedding MATCH ? ORDER BY distance LIMIT 1",
				)
				.all(f32([0.9, 0.1, 0, 0])) as { id: string; distance: number }[];

			expect(rows[0]?.id).toBe("a");
		} finally {
			db.close();
		}
	});
});
