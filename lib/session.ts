import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.SESSION_SECRET || "";
const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30;

function sign(value: string): string {
  return createHmac("sha256", SECRET || "insecure-fallback").update(value).digest("hex").slice(0, 32);
}

/** Reads the signed cookie and returns the email, or "" if it was tampered with. */
export function getSessionEmail(req: NextRequest): string {
  const raw = req.cookies.get(COOKIE)?.value || "";
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return "";
  const email = raw.slice(0, dot);
  const given = raw.slice(dot + 1);
  const want = sign(email);
  if (given.length !== want.length) return "";
  try {
    if (!timingSafeEqual(Buffer.from(given), Buffer.from(want))) return "";
  } catch {
    return "";
  }
  return email;
}

export function setSession(res: NextResponse, email: string): void {
  res.cookies.set(COOKIE, email + "." + sign(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearSession(res: NextResponse): void {
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
}
