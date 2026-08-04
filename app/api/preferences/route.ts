import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "../../../lib/db";
import { getSessionEmail } from "../../../lib/session";

const CREATE_SQL =
  "CREATE TABLE IF NOT EXISTS " +
  P +
  "_preferences (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL UNIQUE, dietary JSONB NOT NULL DEFAULT '[]', cuisines JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMPTZ DEFAULT now())";

export async function GET(req: NextRequest) {
  await ensureTable(CREATE_SQL);
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await q(
    "SELECT dietary, cuisines FROM " + P + "_preferences WHERE user_email = $1",
    [email]
  );
  if (!rows || (rows as any[]).length === 0) {
    return NextResponse.json({ dietary: [], cuisines: [] });
  }
  const row = (rows as any[])[0];
  return NextResponse.json({
    dietary: typeof row.dietary === "string" ? JSON.parse(row.dietary) : (row.dietary ?? []),
    cuisines: typeof row.cuisines === "string" ? JSON.parse(row.cuisines) : (row.cuisines ?? []),
  });
}

export async function POST(req: NextRequest) {
  await ensureTable(CREATE_SQL);
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const dietary: string[] = Array.isArray(body.dietary) ? body.dietary : [];
  const cuisines: string[] = Array.isArray(body.cuisines) ? body.cuisines : [];

  await q(
    "INSERT INTO " +
      P +
      "_preferences (user_email, dietary, cuisines, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (user_email) DO UPDATE SET dietary = $4, cuisines = $5, updated_at = now()",
    [email, JSON.stringify(dietary), JSON.stringify(cuisines), JSON.stringify(dietary), JSON.stringify(cuisines)]
  );

  return NextResponse.json({ ok: true });
}