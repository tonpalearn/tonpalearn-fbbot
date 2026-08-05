/** กติกาคำสำคัญ — แก้ไข / ลบ ทีละข้อ */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../../_lib/data";
import { asInt, asTrimmed, bad, fail, ok, readJson } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_TYPES = ["contains", "exact", "regex"];
const ACTIONS = ["reply", "collect_lead", "handoff", "menu"];

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await readJson(req);
  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const v = asTrimmed(body.name);
    if (v === "") return bad("ชื่อกติกาว่างไม่ได้");
    patch.name = v;
  }
  if (typeof body.pattern === "string") {
    const v = asTrimmed(body.pattern);
    if (v === "") return bad("คำหรือรูปแบบที่จะจับว่างไม่ได้");
    patch.pattern = v;
  }
  if (typeof body.match_type === "string") {
    if (!MATCH_TYPES.includes(body.match_type)) return bad("ชนิดการจับคู่ไม่ถูกต้อง");
    patch.match_type = body.match_type;
  }
  if (typeof body.action === "string") {
    if (!ACTIONS.includes(body.action)) return bad("การกระทำไม่ถูกต้อง");
    patch.action = body.action;
  }
  if (typeof body.reply_text === "string") {
    const v = asTrimmed(body.reply_text);
    patch.reply_text = v === "" ? null : v;
  }
  if (body.priority !== undefined) patch.priority = asInt(body.priority, 100);
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  const finalMatchType = (patch.match_type as string) ?? null;
  const finalPattern = (patch.pattern as string) ?? null;
  if (finalMatchType === "regex" && finalPattern) {
    try {
      new RegExp(finalPattern);
    } catch {
      return bad("รูปแบบ regex เขียนไม่ถูกต้อง ลองตรวจวงเล็บอีกครั้ง");
    }
  }

  if (Object.keys(patch).length === 0) return bad("ไม่มีข้อมูลที่จะแก้");

  try {
    const { data, error } = await db()
      .from("rules")
      .update(patch)
      .eq("id", id)
      .eq("page_id", pageId())
      .select("id,name,match_type,pattern,action,reply_text,quick_replies,priority,is_active,hit_count")
      .maybeSingle();
    if (error) throw error;
    if (!data) return bad("ไม่พบกติกาข้อนี้", 404);
    return ok(data);
  } catch (err) {
    return fail("rules-update", err, "แก้ไขกติกาไม่สำเร็จ");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  try {
    const { error } = await db().from("rules").delete().eq("id", id).eq("page_id", pageId());
    if (error) throw error;
    return ok({ ok: true });
  } catch (err) {
    return fail("rules-delete", err, "ลบกติกาไม่สำเร็จ");
  }
}
