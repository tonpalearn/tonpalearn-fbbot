/** ฐานความรู้ — เปิด/ปิด หรือลบเอกสาร (ท่อนย่อยถูกลบตามด้วย on delete cascade) */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../../_lib/data";
import { bad, fail, ok, readJson } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await readJson(req);
  if (typeof body.is_active !== "boolean") return bad("ต้องระบุว่าจะเปิดหรือปิดการใช้งาน");

  try {
    const { data, error } = await db()
      .from("kb_documents")
      .update({ is_active: body.is_active })
      .eq("id", id)
      .eq("page_id", pageId())
      .select("id,is_active")
      .maybeSingle();
    if (error) throw error;
    if (!data) return bad("ไม่พบเอกสารนี้", 404);
    return ok(data);
  } catch (err) {
    return fail("kb-update", err, "แก้ไขเอกสารไม่สำเร็จ");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  try {
    const { error } = await db()
      .from("kb_documents")
      .delete()
      .eq("id", id)
      .eq("page_id", pageId());
    if (error) throw error;
    return ok({ ok: true });
  } catch (err) {
    return fail("kb-delete", err, "ลบเอกสารไม่สำเร็จ");
  }
}
