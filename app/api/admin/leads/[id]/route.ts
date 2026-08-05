/** ผู้สนใจ — เปลี่ยนสถานะการติดตาม / เพิ่มโน้ต */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../../_lib/data";
import { asTrimmed, bad, fail, ok, readJson } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["new", "contacted", "won", "lost"];

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await readJson(req);
  const patch: Record<string, unknown> = {};

  if (typeof body.status === "string") {
    if (!STATUSES.includes(body.status)) return bad("สถานะไม่ถูกต้อง");
    patch.status = body.status;
  }
  if (typeof body.note === "string") patch.note = asTrimmed(body.note) || null;

  if (Object.keys(patch).length === 0) return bad("ไม่มีข้อมูลที่จะแก้");

  try {
    const { data, error } = await db()
      .from("leads")
      .update(patch)
      .eq("id", id)
      .eq("page_id", pageId())
      .select("id,name,phone,email,interest,lead_type,status,note,created_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return bad("ไม่พบผู้สนใจรายนี้", 404);
    return ok(data);
  } catch (err) {
    return fail("leads-update", err, "แก้ไขข้อมูลผู้สนใจไม่สำเร็จ");
  }
}
