import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

const CREATE = `CREATE TABLE IF NOT EXISTS ${P}_pantry (
  id SERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  ingredient TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_email, ingredient)
)`;

async function setup() {
  await ensureTable(CREATE);
}

export async function GET(req: NextRequest) {
  try {
    await setup();
    const email = await getSessionEmail(req);
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const rows = await q(
      `SELECT id, ingredient FROM ${P}_pantry WHERE user_email = $1 ORDER BY ingredient ASC`,
      [email]
    );
    return NextResponse.json({ items: rows });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await setup();
    const email = await getSessionEmail(req);
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { ingredients } = await req.json();
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return NextResponse.json({ error: "ingredients array required" }, { status: 400 });
    }
    for (const ing of ingredients) {
      const trimmed = String(ing).trim().toLowerCase();
      if (!trimmed) continue;
      await q(
        `INSERT INTO ${P}_pantry (user_email, ingredient) VALUES ($1, $2) ON CONFLICT (user_email, ingredient) DO NOTHING`,
        [email, trimmed]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await setup();
    const email = await getSessionEmail(req);
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await q(
      `DELETE FROM ${P}_pantry WHERE id = $1 AND user_email = $2`,
      [id, email]
    );
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}