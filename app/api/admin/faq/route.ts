/** คำถามที่ถามบ่อย — อ่านทั้งหมด / เพิ่มใหม่ */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../_lib/data";
import { asBool, asStringArray, asTrimmed, bad, fail, ok, readJson } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { data, error } = await db()
      .from("faq_entries")
      .select("id,question,answer,keywords,is_active,hit_count,updated_at")
      .eq("page_id", pageId())
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return ok({ items: data ?? [] });
  } catch (err) {
    return fail("faq-list", err, "อ่านรายการคำถามที่ถามบ่อยไม่สำเร็จ");
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await readJson(req);
  const question = asTrimmed(body.question);
  const answer = asTrimmed(body.answer);

  if (question === "") return bad("กรุณากรอกคำถาม");
  if (answer === "") return bad("กรุณากรอกคำตอบ");

  try {
    const { data, error } = await db()
      .from("faq_entries")
      .insert({
        page_id: pageId(),
        question,
        answer,
        keywords: asStringArray(body.keywords),
        is_active: asBool(body.is_active, true),
      })
      .select("id,question,answer,keywords,is_active,hit_count,updated_at")
      .single();
    if (error) throw error;
    return ok(data);
  } catch (err) {
    return fail("faq-create", err, "เพิ่มคำถามไม่สำเร็จ");
  }
}
