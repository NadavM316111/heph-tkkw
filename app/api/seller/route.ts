import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable, hasDb } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";
export const runtime = "nodejs";

const KEY = process.env.OLYMPUS_STRIPE_KEY || "";

async function sellersTable() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_sellers (" +
    "id SERIAL PRIMARY KEY, " +
    "owner_email TEXT UNIQUE NOT NULL, " +
    "stripe_account_id TEXT, " +
    "payouts_ready BOOLEAN DEFAULT false, " +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
}

async function stripeCall(path: string, form?: URLSearchParams) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + KEY,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? form.toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || "Stripe error");
  return data;
}

/** Is this person set up to receive money yet? */
export async function GET(req: NextRequest) {
  const email = getSessionEmail(req);
  if (!email) return NextResponse.json({ connected: false, ready: false });
  if (!KEY || !hasDb()) return NextResponse.json({ connected: false, ready: false, unavailable: true });

  await sellersTable();
  const rows = await q("SELECT stripe_account_id, payouts_ready FROM " + P + "_sellers WHERE owner_email = $1", [email]);
  const acct = rows[0] && rows[0].stripe_account_id;
  if (!acct) return NextResponse.json({ connected: false, ready: false });

  try {
    const a = await stripeCall("accounts/" + acct);
    const ready = !!(a.charges_enabled && a.payouts_enabled);
    await q("UPDATE " + P + "_sellers SET payouts_ready = $1 WHERE owner_email = $2", [ready, email]);
    return NextResponse.json({ connected: true, ready, accountId: acct });
  } catch {
    return NextResponse.json({ connected: true, ready: false, accountId: acct });
  }
}

/** Start or resume seller onboarding. Returns { url } to send them to. */
export async function POST(req: NextRequest) {
  const email = getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!KEY) return NextResponse.json({ error: "Payments are not set up on this deployment." }, { status: 500 });

  await sellersTable();
  const origin = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;

  try {
    const rows = await q("SELECT stripe_account_id FROM " + P + "_sellers WHERE owner_email = $1", [email]);
    let acct = rows[0] && rows[0].stripe_account_id;

    if (!acct) {
      const f = new URLSearchParams();
      f.set("type", "express");
      f.set("email", email);
      f.set("capabilities[transfers][requested]", "true");
      f.set("capabilities[card_payments][requested]", "true");
      const created = await stripeCall("accounts", f);
      acct = created.id;
      await q(
        "INSERT INTO " + P + "_sellers (owner_email, stripe_account_id) VALUES ($1, $2) " +
        "ON CONFLICT (owner_email) DO UPDATE SET stripe_account_id = EXCLUDED.stripe_account_id",
        [email, acct]
      );
    }

    const lf = new URLSearchParams();
    lf.set("account", acct);
    lf.set("refresh_url", origin + "/?seller=retry");
    lf.set("return_url", origin + "/?seller=done");
    lf.set("type", "account_onboarding");
    const link = await stripeCall("account_links", lf);
    return NextResponse.json({ ok: true, url: link.url, accountId: acct });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not start onboarding." }, { status: 500 });
  }
}