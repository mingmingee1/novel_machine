import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export class Store {
  db: DatabaseSync;
  private depth = 0;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      readFileSync(
        new URL("./migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  get<T>(kind: string, key: string): T | undefined {
    const row = this.db
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, key) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  require<T>(kind: string, key: string): T {
    const value = this.get<T>(kind, key);
    if (!value) throw new AppError(404, "기록을 찾을 수 없습니다.");
    return value;
  }
  list<T>(kind: string, projectId?: string, branchId?: string): T[] {
    let sql = "SELECT data FROM records WHERE kind=?";
    const args = [kind];
    if (projectId !== undefined) {
      sql += " AND project_id=?";
      args.push(projectId);
    }
    if (branchId !== undefined) {
      sql += " AND branch_id=?";
      args.push(branchId);
    }
    return (
      this.db.prepare(sql + " ORDER BY rowid").all(...args) as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data));
  }
  put<T extends { id: string; projectId?: string; branchId?: string }>(
    kind: string,
    value: T,
  ): T {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,project_id,branch_id,data) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,project_id=excluded.project_id,branch_id=excluded.branch_id",
      )
      .run(
        kind,
        value.id,
        value.projectId ?? "",
        value.branchId ?? "",
        JSON.stringify(value),
      );
    return value;
  }
  transaction<T>(fn: () => T): T {
    const depth = this.depth++,
      savepoint = "nested_" + depth;
    this.db.exec(depth ? "SAVEPOINT " + savepoint : "BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec(depth ? "RELEASE " + savepoint : "COMMIT");
      return result;
    } catch (e) {
      this.db.exec(depth ? "ROLLBACK TO " + savepoint : "ROLLBACK");
      if (depth) this.db.exec("RELEASE " + savepoint);
      throw e;
    } finally {
      this.depth--;
    }
  }
  event(jobId: string, type: string, data: unknown) {
    return this.db
      .prepare(
        "INSERT INTO events(job_id,type,data,created_at) VALUES(?,?,?,?)",
      )
      .run(jobId, type, JSON.stringify(data), now());
  }
  events(jobId: string, after = 0) {
    return this.db
      .prepare(
        "SELECT seq,type,data,created_at AS createdAt FROM events WHERE job_id=? AND seq>? ORDER BY seq LIMIT 200",
      )
      .all(jobId, after);
  }
  close() {
    this.db.close();
  }
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
