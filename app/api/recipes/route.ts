import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable } from "../../../lib/db";
import { getSessionEmail } from "../../../lib/session";

const CREATE_SQL =
  "CREATE TABLE IF NOT EXISTS " +
  P +
  "_recipes (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, detection_id INTEGER NOT NULL DEFAULT 0, uuid TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, ingredients_used JSONB NOT NULL, extra_ingredients_needed JSONB, steps JSONB NOT NULL, total_time_minutes INTEGER, difficulty TEXT, cuisine TEXT, ai_model_version TEXT, created_at TIMESTAMPTZ DEFAULT now())";

export async function POST(req: NextRequest) {
  await ensureTable(CREATE_SQL);

  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const recipe = body.recipe;
  if (!recipe || !recipe.title || !Array.isArray(recipe.steps)) {
    return NextResponse.json({ error: "Invalid recipe" }, { status: 400 });
  }

  // Generate a UUID for a stable shareable link
  const uuid = crypto.randomUUID();

  await q(
    "INSERT INTO " +
      P +
      "_recipes (user_email, uuid, title, description, ingredients_used, extra_ingredients_needed, steps, total_time_minutes, difficulty, cuisine) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [
      email,
      uuid,
      recipe.title,
      recipe.description ?? "",
      JSON.stringify(recipe.ingredients_used ?? []),
      JSON.stringify(recipe.extra_ingredients_needed ?? []),
      JSON.stringify(recipe.steps),
      recipe.total_time_minutes ?? null,
      recipe.difficulty ?? null,
      recipe.cuisine ?? null,
    ]
  );

  return NextResponse.json({ uuid });
}

export async function GET(req: NextRequest) {
  await ensureTable(CREATE_SQL);

  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await q(
    "SELECT * FROM " + P + "_recipes WHERE user_email = $1 ORDER BY created_at DESC LIMIT 50",
    [email]
  );
  return NextResponse.json({ recipes: rows });
}