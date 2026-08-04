import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
const client = url ? neon(url) : null;

export const P = (process.env.APP_TABLE_PREFIX || "heph_app").replace(/[^a-z0-9_]/g, "");

export function hasDb(): boolean {
  return !!client;
}

/**
 * Run a query. Returns the rows as an array. Most Postgres clients return
 * { rows: [...] }, so the array also carries a .rows pointing at itself —
 * both styles work and both typecheck.
 */
export async function q(text: string, params: any[] = []): Promise<any> {
  let out: any = [];
  if (client) {
    const parts = text.split(/\$\d+/);
    const strings: any = [...parts];
    strings.raw = [...parts];
    out = (await (client as any)(strings, ...params)) as any[];
  }
  if (!Array.isArray(out)) out = [];
  try { Object.defineProperty(out, "rows", { value: out, enumerable: false, configurable: true }); } catch {}
  return out;
}

let ready = false;

/** The tables every app has. Takes NO arguments. */
export async function ensure(): Promise<void> {
  if (!client || ready) return;
  await q("CREATE TABLE IF NOT EXISTS " + P + "_users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, paid BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now())");
  await q("ALTER TABLE " + P + "_users ADD COLUMN IF NOT EXISTS paid BOOLEAN DEFAULT false");
  await q("CREATE TABLE IF NOT EXISTS " + P + "_visits (id SERIAL PRIMARY KEY, path TEXT, at TIMESTAMPTZ DEFAULT now())");
  ready = true;
}

const made = new Set<string>();

/**
 * Create one of YOUR tables. Pass a full CREATE TABLE IF NOT EXISTS statement.
 * Safe to call at the top of every request: it touches the database only once
 * per statement per server instance.
 */
export async function ensureTable(createSql: string): Promise<void> {
  if (!client) return;
  const key = createSql.replace(/\s+/g, " ").trim();
  if (made.has(key)) return;
  await q(createSql);
  made.add(key);
}
