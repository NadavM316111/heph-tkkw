import { NextRequest, NextResponse } from "next/server";
import { q, P, ensure, hasDb } from "@/lib/db";
import { setSession, clearSession, getSessionEmail } from "@/lib/session";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
export const runtime = "nodejs";

function hash(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pw, salt, 64).toString("hex");
}
function verify(pw: string, stored: string) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 2) return false;
  const a = Buffer.from(parts[1], "hex");
  const b = scryptSync(pw, parts[0], 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ email: getSessionEmail(req) });
}

export async function POST(req: NextRequest) {
  if (!hasDb()) return NextResponse.json({ error: "No database configured." }, { status: 500 });
  await ensure();
  const body = await req.json().catch(() => ({}));
  const mode = body.mode;

  if (mode === "logout") {
    const res = NextResponse.json({ ok: true });
    clearSession(res);
    return res;
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return NextResponse.json({ error: "Email and password required." }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });

  if (mode === "signup") {
    const existing = await q("SELECT id FROM " + P + "_users WHERE email = $1", [email]);
    if (existing.length) return NextResponse.json({ error: "Account already exists." }, { status: 400 });
    await q("INSERT INTO " + P + "_users (email, pass) VALUES ($1, $2)", [email, hash(password)]);
    const res = NextResponse.json({ ok: true, email });
    setSession(res, email);
    return res;
  }

  const rows = await q("SELECT pass FROM " + P + "_users WHERE email = $1", [email]);
  if (!rows.length || !verify(password, rows[0].pass)) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, email });
  setSession(res, email);
  return res;
}
