/** คำถามที่ถามบ่อย — แก้ไข / ลบ ทีละข้อ */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../../_lib/data";
import { asStringArray, asTrimmed, bad, fail, ok, readJson } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await readJson(req);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.question === "string") {
    const q = asTrimmed(body.question);
    if (q === "") return bad("คำถามว่างไม่ได้");
    patch.question = q;
  }
  if (typeof body.answer === "string") {
    const a = asTrimmed(body.answer);
    if (a === "") return bad("คำตอบว่างไม่ได้");
    patch.answer = a;
  }
  if (Array.isArray(body.keywords)) patch.keywords = asStringArray(body.keywords);
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  try {
    const { data, error } = await db()
      .from("faq_entries")
      .update(patch)
      .eq("id", id)
      .eq("page_id", pageId())
      .select("id,question,answer,keywords,is_active,hit_count,updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return bad("ไม่พบคำถามข้อนี้", 404);
    return ok(data);
  } catch (err) {
    return fail("faq-update", err, "แก้ไขคำถามไม่สำเร็จ");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  try {
    const { error } = await db()
      .from("faq_entries")
      .delete()
      .eq("id", id)
      .eq("page_id", pageId());
    if (error) throw error;
    return ok({ ok: true });
  } catch (err) {
    return fail("faq-delete", err, "ลบคำถามไม่สำเร็จ");
  }
}
