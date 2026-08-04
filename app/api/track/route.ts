import { NextRequest, NextResponse } from "next/server";
import { q, P, ensure, hasDb } from "@/lib/db";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!hasDb()) return NextResponse.json({ ok: false });
  await ensure();
  const body = await req.json().catch(() => ({ path: "/" }));
  try {
    await q("INSERT INTO " + P + "_visits (path) VALUES ($1)", [body.path || "/"]);
  } catch {}
  return NextResponse.json({ ok: true });
}
