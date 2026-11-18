/** ผู้สนใจที่บอตเก็บได้ */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../_lib/data";
import { thaiDateRange } from "@/lib/today";
import { asInt, asTrimmed, fail, ok } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["new", "contacted", "won", "lost"];

export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(req.url);
  const status = asTrimmed(url.searchParams.get("status"));
  // ตัวกรองช่วงวันที่เก็บข้อมูลได้ (วันตามปฏิทินไทย) — ?from=YYYY-MM-DD&to=YYYY-MM-DD ใส่ช่องเดียวก็ได้
  const range = thaiDateRange(url.searchParams.get("from"), url.searchParams.get("to"));
  const limit = Math.min(Math.max(asInt(url.searchParams.get("limit"), 200), 1), 1000);

  // source/segment/line_id/qualification มาจาก migration 0003
  // ถ้ายังไม่ได้รัน 0003 ให้ถอยไปอ่านคอลัมน์ชุดเดิม หน้าผู้สนใจจะได้ไม่พังทั้งหน้า
  const FULL =
    "id,name,phone,email,line_id,interest,lead_type,status,note,created_at,conversation_id,source,segment,qualification";
  const LEGACY = "id,name,phone,email,interest,lead_type,status,note,created_at,conversation_id";

  const run = (cols: string) => {
    let q = db()
      .from("leads")
      .select(cols)
      .eq("page_id", pageId())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status !== "" && STATUSES.includes(status)) q = q.eq("status", status);
    if (range.gte) q = q.gte("created_at", range.gte);
    if (range.lt) q = q.lt("created_at", range.lt);
    return q;
  };

  try {
    let { data, error } = await run(FULL);
    if (error && /column|42703|PGRST204/i.test(`${error.code} ${error.message}`)) {
      ({ data, error } = await run(LEGACY));
    }
    if (error) throw error;
    return ok({ items: data ?? [] });
  } catch (err) {
    return fail("leads-list", err, "อ่านรายชื่อผู้สนใจไม่สำเร็จ");
  }
}
