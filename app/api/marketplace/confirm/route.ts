import { NextRequest, NextResponse } from "next/server";
import { q, P, hasDb } from "@/lib/db";
export const runtime = "nodejs";

const KEY = process.env.OLYMPUS_STRIPE_KEY || "";

/**
 * The buyer lands here after paying. Verify the payment really went
 * through, then pay each seller their share.
 */
export async function GET(req: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!KEY || !sessionId || !hasDb()) return NextResponse.redirect(origin + "/?checkout=error");

  try {
    const res = await fetch(
      "https://api.stripe.com/v1/checkout/sessions/" + sessionId + "?expand[]=payment_intent",
      { headers: { Authorization: "Bearer " + KEY } }
    );
    const s = await res.json();
    const paid = s && (s.payment_status === "paid" || s.status === "complete");
    if (!paid) return NextResponse.redirect(origin + "/?checkout=unpaid");

    const pi = s.payment_intent;
    const chargeId = pi && (pi.latest_charge || (pi.charges && pi.charges.data && pi.charges.data[0] && pi.charges.data[0].id));
    const group = pi && pi.transfer_group;

    const owed = await q(
      "SELECT id, stripe_account_id, amount_cents FROM " + P + "_payouts WHERE session_id = $1 AND transferred = false",
      [sessionId]
    );

    for (const row of owed) {
      const f = new URLSearchParams();
      f.set("amount", String(row.amount_cents));
      f.set("currency", "usd");
      f.set("destination", row.stripe_account_id);
      if (group) f.set("transfer_group", group);
      // Paying out of this specific charge makes the money available
      // immediately instead of waiting for the platform balance.
      if (chargeId) f.set("source_transaction", String(chargeId));

      const tr = await fetch("https://api.stripe.com/v1/transfers", {
        method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/x-www-form-urlencoded" },
        body: f.toString(),
      });
      if (tr.ok) {
        await q("UPDATE " + P + "_payouts SET transferred = true WHERE id = $1", [row.id]);
      }
    }

    return NextResponse.redirect(origin + "/?checkout=success&order=" + encodeURIComponent(sessionId));
  } catch {
    return NextResponse.redirect(origin + "/?checkout=error");
  }
}