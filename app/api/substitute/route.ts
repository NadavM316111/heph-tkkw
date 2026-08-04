import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { ingredient, recipeTitle, stepInstruction } = await req.json();

    if (!ingredient || typeof ingredient !== "string") {
      return NextResponse.json({ error: "ingredient is required" }, { status: 400 });
    }

    const system =
      "You are a practical cooking assistant. When asked for substitutes for an ingredient, respond with ONLY a JSON array — no markdown, no explanation. Each object must have exactly two string fields: \"substitute\" (the replacement ingredient or technique) and \"rationale\" (one sentence explaining why it works and any adjustment needed). Return 2–3 substitutes. Example: [{\"substitute\":\"Greek yogurt\",\"rationale\":\"Works 1:1 for sour cream; adds a slight tang but keeps the creaminess.\"}]";

    const contextParts: string[] = [];
    if (recipeTitle) contextParts.push(`Recipe: ${recipeTitle}.`);
    if (stepInstruction) contextParts.push(`Current step: "${stepInstruction}".`);
    contextParts.push(`What are practical substitutes for: ${ingredient}?`);

    const aiRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/ai`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system,
          messages: [{ role: "user", content: contextParts.join(" ") }],
        }),
      }
    );

    if (!aiRes.ok) throw new Error("AI request failed");
    const { text } = await aiRes.json();

    let substitutes: { substitute: string; rationale: string }[] = [];
    try {
      const cleaned = text.replace(/```[a-z]*\n?/gi, "").trim();
      substitutes = JSON.parse(cleaned);
      if (!Array.isArray(substitutes)) substitutes = [];
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) substitutes = JSON.parse(match[0]);
    }

    // Validate shape
    substitutes = substitutes.filter(
      (s) => s && typeof s.substitute === "string" && typeof s.rationale === "string"
    );

    return NextResponse.json({ substitutes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}