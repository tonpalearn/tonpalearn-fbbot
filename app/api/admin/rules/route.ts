/** กติกาคำสำคัญ — อ่านทั้งหมด / เพิ่มใหม่ */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../_lib/data";
import { asBool, asInt, asTrimmed, bad, fail, ok, readJson } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_TYPES = ["contains", "exact", "regex"];
const ACTIONS = ["reply", "collect_lead", "handoff", "menu"];

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { data, error } = await db()
      .from("rules")
      .select("id,name,match_type,pattern,action,reply_text,quick_replies,priority,is_active,hit_count")
      .eq("page_id", pageId())
      .order("priority", { ascending: true });
    if (error) throw error;
    return ok({ items: data ?? [] });
  } catch (err) {
    return fail("rules-list", err, "อ่านรายการกติกาไม่สำเร็จ");
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await readJson(req);
  const name = asTrimmed(body.name);
  const pattern = asTrimmed(body.pattern);
  const matchType = asTrimmed(body.match_type) || "contains";
  const action = asTrimmed(body.action) || "reply";
  const replyText = asTrimmed(body.reply_text);

  if (name === "") return bad("กรุณาตั้งชื่อกติกา");
  if (pattern === "") return bad("กรุณากรอกคำหรือรูปแบบที่จะให้จับ");
  if (!MATCH_TYPES.includes(matchType)) return bad("ชนิดการจับคู่ไม่ถูกต้อง");
  if (!ACTIONS.includes(action)) return bad("การกระทำไม่ถูกต้อง");
  if (action === "reply" && replyText === "") {
    return bad("กติกาแบบ “ตอบข้อความ” ต้องกรอกข้อความตอบด้วย");
  }
  if (matchType === "regex") {
    try {
      new RegExp(pattern);
    } catch {
      return bad("รูปแบบ regex เขียนไม่ถูกต้อง ลองตรวจวงเล็บอีกครั้ง");
    }
  }

  try {
    const { data, error } = await db()
      .from("rules")
      .insert({
        page_id: pageId(),
        name,
        match_type: matchType,
        pattern,
        action,
        reply_text: replyText === "" ? null : replyText,
        priority: asInt(body.priority, 100),
        is_active: asBool(body.is_active, true),
      })
      .select("id,name,match_type,pattern,action,reply_text,quick_replies,priority,is_active,hit_count")
      .single();
    if (error) throw error;
    return ok(data);
  } catch (err) {
    return fail("rules-create", err, "เพิ่มกติกาไม่สำเร็จ");
  }
}
