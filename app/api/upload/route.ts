import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSessionEmail } from "@/lib/session";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export async function POST(req: NextRequest) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: "Uploads are not configured on this deployment." }, { status: 500 });

  const email = getSessionEmail(req);
  if (!email) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send a multipart form with a file field." }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file was attached." }, { status: 400 });

  const blobFile = file as File;
  if (blobFile.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is over 8MB. Pick a smaller one." }, { status: 400 });
  }
  if (blobFile.type && !ALLOWED.includes(blobFile.type)) {
    return NextResponse.json({ error: "Images and PDFs only." }, { status: 400 });
  }

  try {
    const safe = (blobFile.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60);
    const key = (process.env.APP_TABLE_PREFIX || "app") + "/" + Date.now().toString(36) + "-" + safe;
    const blob = await put(key, blobFile, { access: "public", token, addRandomSuffix: true });
    return NextResponse.json({ ok: true, url: blob.url, name: blobFile.name, size: blobFile.size });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Upload failed." }, { status: 500 });
  }
}
