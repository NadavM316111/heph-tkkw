import { NextRequest, NextResponse } from "next/server";
import { getSessionEmail } from "../../../lib/session";
import { q, P, ensureTable } from "../../../lib/db";
import { put } from "@vercel/blob";
import { buildWatchPrompt } from "../../../lib/watch-cook-utils";
import type { Recipe } from "../../../types/cooking";

await ensureTable(
  "CREATE TABLE IF NOT EXISTS " + P + "_recipes (" +
  "id SERIAL PRIMARY KEY, " +
  "user_email TEXT NOT NULL, " +
  "detection_id INTEGER NOT NULL, " +
  "title TEXT NOT NULL, " +
  "description TEXT, " +
  "ingredients_used JSONB NOT NULL, " +
  "extra_ingredients_needed JSONB, " +
  "steps JSONB NOT NULL, " +
  "total_time_minutes INTEGER, " +
  "difficulty TEXT, " +
  "cuisine TEXT, " +
  "ai_model_version TEXT, " +
  "created_at TIMESTAMPTZ DEFAULT now()" +
  ")"
);

export async function POST(req: NextRequest) {
  const email = getSessionEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    imageDataUrl?: string;
    recipeId?: number;
    stepIndex?: number;
    mode?: "auto" | "manual";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { imageDataUrl, recipeId, stepIndex = 0, mode = "auto" } = body;

  if (!imageDataUrl || typeof imageDataUrl !== "string") {
    return NextResponse.json({ error: "imageDataUrl is required" }, { status: 400 });
  }

  // ── 1. Look up recipe from DB (scoped to this user) ───────────────────
  let recipe: Recipe | null = null;

  if (recipeId != null) {
    const rows = await q(
      "SELECT title, description, ingredients_used, extra_ingredients_needed, steps, total_time_minutes, difficulty FROM " +
        P + "_recipes WHERE id = $1 AND user_email = $2",
      [recipeId, email]
    );
    if (rows.length > 0) {
      const row = rows[0];
      recipe = {
        title: row.title,
        description: row.description ?? "",
        total_time_minutes: row.total_time_minutes ?? 0,
        difficulty: row.difficulty ?? "medium",
        ingredients_used: row.ingredients_used ?? [],
        extra_ingredients_needed: row.extra_ingredients_needed ?? [],
        steps: row.steps ?? [],
      } as Recipe;
    }
  }

  // ── 2. Convert data URL → Buffer → upload to Vercel Blob ─────────────
  let imageUrl: string;
  try {
    const matches = imageDataUrl.match(/^data:([a-zA-Z0-9+/]+\/[a-zA-Z0-9+/]+);base64,(.+)$/);
    if (!matches) throw new Error("Invalid data URL format");
    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");
    const filename = `check-pan-${Date.now()}.jpg`;
    const blob = await put(filename, buffer, {
      access: "public",
      contentType: mimeType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    imageUrl = blob.url;
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to upload frame image" },
      { status: 500 }
    );
  }

  // ── 3. Build the vision prompt ────────────────────────────────────────
  let systemPrompt: string;
  if (recipe) {
    systemPrompt = buildWatchPrompt(recipe, stepIndex, mode);
  } else {
    // Fallback if no recipe found — generic pan-watching prompt
    systemPrompt = [
      mode === "auto"
        ? "You are periodically checking in on a home cook. Briefly assess what you see."
        : "The cook has asked for your assessment. Give a clear, direct answer.",
      "",
      "Look at the photo and answer ALL of the following:",
      "1. Is the cook on track? (yes / not yet / something looks wrong)",
      "2. In one short sentence, describe what you actually see happening in the pan or on the counter.",
      "3. Is it safe to move on to the next step? (yes / no / almost — wait a bit longer)",
      "4. Any brief tip or warning the cook should hear right now? (keep it under 15 words, or say 'none')",
      "",
      "Reply in exactly this JSON format with no markdown fencing:",
      '{ "onTrack": "yes|not yet|something looks wrong", "observation": "...", "readyForNext": "yes|no|almost", "tip": "..." }',
    ].join("\n");
  }

  // ── 4. Call OpenAI vision API ─────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI not configured" }, { status: 500 });
  }

  let aiJson: {
    onTrack: string;
    observation: string;
    readyForNext: string;
    tip: string;
  };

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Here is the current state of my cooking. Please assess it.",
              },
              {
                type: "image_url",
                image_url: { url: imageUrl, detail: "low" },
              },
            ],
          },
        ],
        max_tokens: 256,
        temperature: 0.3,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(`OpenAI error ${openaiRes.status}: ${errText}`);
    }

    const openaiData = await openaiRes.json();
    const rawText: string = openaiData.choices?.[0]?.message?.content ?? "";

    // Strip markdown fences if model wrapped the JSON
    const cleaned = rawText.replace(/```[a-z]*\n?/gi, "").trim();
    aiJson = JSON.parse(cleaned);
  } catch (err) {
    return NextResponse.json(
      { error: "AI vision request failed" },
      { status: 502 }
    );
  }

  // ── 5. Derive commentary and hasChange ───────────────────────────────
  const parts: string[] = [];

  if (aiJson.observation) parts.push(aiJson.observation);

  if (aiJson.tip && aiJson.tip.toLowerCase() !== "none") {
    parts.push(aiJson.tip);
  }

  if (aiJson.readyForNext === "yes") {
    parts.push("Looks like you're ready for the next step!");
  } else if (aiJson.readyForNext === "almost") {
    parts.push("Almost there — give it a little longer.");
  } else if (aiJson.onTrack === "something looks wrong") {
    parts.push("Something may need your attention.");
  }

  const commentary = parts.join(" ").trim() || "Looking good — keep going!";

  // hasChange = true when the visual state is meaningful enough to surface to the user
  const hasChange =
    aiJson.onTrack === "something looks wrong" ||
    aiJson.readyForNext === "yes" ||
    aiJson.readyForNext === "almost";

  return NextResponse.json({ commentary, hasChange, detail: aiJson });
}