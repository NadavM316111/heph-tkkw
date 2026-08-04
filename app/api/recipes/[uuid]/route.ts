import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "../../../../lib/db";

const CREATE_SQL =
  "CREATE TABLE IF NOT EXISTS " +
  P +
  "_recipes (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, detection_id INTEGER NOT NULL DEFAULT 0, uuid TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, ingredients_used JSONB NOT NULL, extra_ingredients_needed JSONB, steps JSONB NOT NULL, total_time_minutes INTEGER, difficulty TEXT, cuisine TEXT, ai_model_version TEXT, created_at TIMESTAMPTZ DEFAULT now())";

// Public route — no auth required (recipes are shareable by UUID)
export async function GET(
  _req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  await ensureTable(CREATE_SQL);

  const { uuid } = params;
  if (!uuid) return NextResponse.json({ error: "Missing uuid" }, { status: 400 });

  const rows = await q(
    "SELECT * FROM " + P + "_recipes WHERE uuid = $1 LIMIT 1",
    [uuid]
  );

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
  }

  const row = rows[0];
  const recipe = {
    id: row.id,
    uuid: row.uuid,
    title: row.title,
    description: row.description,
    ingredients_used: row.ingredients_used,
    extra_ingredients_needed: row.extra_ingredients_needed ?? [],
    steps: row.steps,
    total_time_minutes: row.total_time_minutes,
    difficulty: row.difficulty,
    cuisine: row.cuisine,
    created_at: row.created_at,
  };

  return NextResponse.json({ recipe });
}