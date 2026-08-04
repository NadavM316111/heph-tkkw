import { NextRequest, NextResponse } from "next/server";
import { getSessionEmail } from "../../../../lib/session";

export async function POST(req: NextRequest) {
  const email = await getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { recipe, multiplier, difficulty } = body as {
    recipe: {
      title: string;
      description: string;
      total_time_minutes: number;
      difficulty: string;
      ingredients_used: string[];
      extra_ingredients_needed: string[];
      steps: { step_number: number; instruction: string }[];
      source_inspiration?: string;
    };
    multiplier: number;
    difficulty: "simplify" | "as-is" | "challenge";
  };

  if (!recipe || !recipe.title || !Array.isArray(recipe.steps)) {
    return NextResponse.json({ error: "Invalid recipe" }, { status: 400 });
  }

  const validMultipliers = [0.5, 1, 2, 4];
  if (!validMultipliers.includes(multiplier)) {
    return NextResponse.json({ error: "Invalid multiplier" }, { status: 400 });
  }

  const difficultyInstructions: Record<string, string> = {
    simplify:
      "Simplify the technique in each step: remove advanced or fussy techniques, use simpler substitutions where helpful, and write instructions that a beginner can follow with confidence. Keep steps concise.",
    "as-is":
      "Keep the technique and complexity exactly as-is. Only adjust quantities for the serving multiplier.",
    challenge:
      "Elevate the technique in each step: add professional chef tips, precision temperatures, advanced techniques (e.g. mise en place, deglazing, tempering), and refinements that an experienced home cook would appreciate.",
  };

  const multiplierLabel =
    multiplier === 0.5 ? "half" : multiplier === 1 ? "the same number of" : `${multiplier}x`;

  const systemPrompt = `You are a professional recipe editor. You will receive a recipe as JSON and return an adapted version as JSON.

Serving adjustment: Scale all ingredient quantities to ${multiplierLabel} servings (multiplier: ${multiplier}). Adjust timings proportionally where relevant (e.g. larger quantities may need slightly longer cooking).

Style instruction: ${difficultyInstructions[difficulty] ?? difficultyInstructions["as-is"]}

Return ONLY a JSON object with exactly the same shape as the input recipe — no markdown, no explanation. Fields:
{
  "title": string,
  "description": string,
  "total_time_minutes": number,
  "difficulty": string,
  "ingredients_used": string[],
  "extra_ingredients_needed": string[],
  "source_inspiration": string,
  "steps": [{ "step_number": number, "instruction": string }]
}

Important:
- Update ingredient quantities in "ingredients_used" to reflect the multiplier (e.g. "2 eggs" → "4 eggs" for 2× multiplier).
- Rewrite step instructions to reflect the new quantities.
- Do NOT change the dish itself or omit steps.
- Keep step count the same unless the style instruction genuinely merits splitting or merging a step.`;

  const userMessage = `Here is the recipe to adapt:\n${JSON.stringify(recipe, null, 2)}`;

  const aiRes = await fetch(`${req.nextUrl.origin}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!aiRes.ok) {
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }

  const { text } = await aiRes.json();

  let adapted: typeof recipe;
  try {
    const cleaned = text.replace(/```[a-z]*\n?/gi, "").trim();
    adapted = JSON.parse(cleaned);
    if (!adapted || !adapted.title || !Array.isArray(adapted.steps)) {
      throw new Error("Bad shape");
    }
  } catch {
    return NextResponse.json({ error: "AI returned unexpected format" }, { status: 502 });
  }

  return NextResponse.json({ recipe: adapted });
}