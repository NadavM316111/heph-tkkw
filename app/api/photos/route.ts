import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";

async function setup() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_photos (" +
    "  id SERIAL PRIMARY KEY," +
    "  user_email TEXT NOT NULL," +
    "  image_url TEXT NOT NULL," +
    "  source TEXT NOT NULL," +
    "  created_at TIMESTAMPTZ DEFAULT now()" +
    ")"
  );
}

export async function POST(req: NextRequest) {
  await setup();

  const email = await getSessionEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { imageUrl, source } = await req.json();
  if (!imageUrl || !source) {
    return NextResponse.json({ error: "Missing imageUrl or source" }, { status: 400 });
  }

  const rows = await q(
    "INSERT INTO " + P + "_photos (user_email, image_url, source) VALUES ($1, $2, $3) RETURNING id",
    [email, imageUrl, source]
  );

  return NextResponse.json({ id: rows[0].id, url: imageUrl });
}

export async function GET(req: NextRequest) {
  await setup();

  const email = await getSessionEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await q(
    "SELECT id, image_url, source, created_at FROM " + P + "_photos WHERE user_email = $1 ORDER BY created_at DESC",
    [email]
  );

  return NextResponse.json({ photos: rows });
}