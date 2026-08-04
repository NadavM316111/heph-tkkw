import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "OPENAI_API_KEY not set on this deployment." }, { status: 500 });
  const { messages, system } = await req.json();
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [...(system ? [{ role: "system", content: system }] : []), ...(messages || [])],
    }),
  });
  const d = await r.json();
  if (d?.error) return NextResponse.json({ error: d.error.message }, { status: 500 });
  return NextResponse.json({ text: d?.choices?.[0]?.message?.content || "" });
}
