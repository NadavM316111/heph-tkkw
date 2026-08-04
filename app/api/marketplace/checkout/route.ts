import { NextRequest, NextResponse } from "next/server";
import { q, P, ensureTable, hasDb } from "@/lib/db";
import { getSessionEmail } from "@/lib/session";
export const runtime = "nodejs";

const KEY = process.env.OLYMPUS_STRIPE_KEY || "";
const FEE_PCT = parseInt(process.env.OLYMPUS_APPLICATION_FEE_PERCENT || "2", 10);

async function payoutsTable() {
  await ensureTable(
    "CREATE TABLE IF NOT EXISTS " + P + "_payouts (" +
    "id SERIAL PRIMARY KEY, " +
    "session_id TEXT NOT NULL, " +
    "buyer_email TEXT, " +
    "seller_email TEXT NOT NULL, " +
    "stripe_account_id TEXT NOT NULL, " +
    "amount_cents INTEGER NOT NULL, " +
    "fee_cents INTEGER NOT NULL, " +
    "transferred BOOLEAN DEFAULT false, " +
    "created_at TIMESTAMPTZ DEFAULT now())"
  );
}

/**
 * POST { items: [{ name, amount_cents, quantity, seller_email }] }
 * One payment for the whole cart. Sellers are paid after it clears.
 */
export async function POST(req: NextRequest) {
  if (!KEY) return NextResponse.json({ error: "Payments are not set up on this deployment." }, { status: 500 });
  if (!hasDb()) return NextResponse.json({ error: "No database configured." }, { status: 500 });

  const buyer = getSessionEmail(req);
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  await payoutsTable();
  const origin = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;

  const bySeller: Record<string, number> = {};
  const lineItems: { name: string; amount: number; qty: number }[] = [];

  for (const it of items) {
    const sellerEmail = String(it.seller_email || "").trim().toLowerCase();
    const amount = Math.round(Number(it.amount_cents) || 0);
    const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
    const name = String(it.name || "Item").slice(0, 120);
    if (!sellerEmail || amount < 50) {
      return NextResponse.json({ error: "Every item needs a seller and a price of at least 50 cents." }, { status: 400 });
    }
    bySeller[sellerEmail] = (bySeller[sellerEmail] || 0) + amount * qty;
    lineItems.push({ name, amount, qty });
  }

  const sellers = Object.keys(bySeller);
  const rows = await q(
    "SELECT owner_email, stripe_account_id, payouts_ready FROM " + P + "_sellers WHERE owner_email = ANY($1)",
    [sellers]
  );
  const accountOf: Record<string, string> = {};
  for (const r of rows) {
    if (r.stripe_account_id && r.payouts_ready) accountOf[r.owner_email] = r.stripe_account_id;
  }
  const missing = sellers.filter((s) => !accountOf[s]);
  if (missing.length) {
    return NextResponse.json(
      { error: "These sellers have not finished setting up payouts yet: " + missing.join(", ") },
      { status: 400 }
    );
  }

  const group = "cart_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  try {
    const f = new URLSearchParams();
    f.set("mode", "payment");
    lineItems.forEach((li, i) => {
      f.set("line_items[" + i + "][quantity]", String(li.qty));
      f.set("line_items[" + i + "][price_data][currency]", "usd");
      f.set("line_items[" + i + "][price_data][product_data][name]", li.name);
      f.set("line_items[" + i + "][price_data][unit_amount]", String(li.amount));
    });
    f.set("payment_intent_data[transfer_group]", group);
    f.set("success_url", origin + "/api/marketplace/confirm?session_id={CHECKOUT_SESSION_ID}");
    f.set("cancel_url", origin + "/?checkout=cancelled");
    if (buyer) { f.set("client_reference_id", buyer); f.set("customer_email", buyer); }

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: f.toString(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error && data.error.message) || "Stripe error");

    // Write down who is owed what BEFORE they pay, so confirm never guesses.
    for (const sellerEmail of sellers) {
      const gross = bySeller[sellerEmail];
      const fee = Math.round((gross * FEE_PCT) / 100);
      await q(
        "INSERT INTO " + P + "_payouts (session_id, buyer_email, seller_email, stripe_account_id, amount_cents, fee_cents) " +
        "VALUES ($1, $2, $3, $4, $5, $6)",
        [data.id, buyer || "", sellerEmail, accountOf[sellerEmail], gross - fee, fee]
      );
    }

    return NextResponse.json({ url: data.url, sessionId: data.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Checkout failed." }, { status: 500 });
  }
}