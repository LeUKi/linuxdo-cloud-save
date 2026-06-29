import { readdir, readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { afterAll } from "vitest";

let counter = 0;
const instances: Miniflare[] = [];

async function applyMigration(db: D1Database): Promise<void> {
  const files = (await readdir("./migrations")).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(`./migrations/${file}`, "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  }
}

export async function migratedDb(): Promise<D1Database> {
  counter += 1;
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    d1Databases: { DB: `test-db-${counter}` }
  });
  instances.push(mf);
  const db = await mf.getD1Database("DB");
  await applyMigration(db);
  return db as D1Database;
}

afterAll(async () => {
  await Promise.all(instances.map((mf) => mf.dispose()));
});
