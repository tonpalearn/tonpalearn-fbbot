/**
 * ทดลองพิมพ์ข้อความ แล้วดูว่ากติกาข้อไหนจะโดนจับ
 * ใช้ตรรกะตัวเดียวกับที่บอตใช้จริง (lib/matching.ts) จะได้ไม่เพี้ยนจากของจริง
 */
import { requireAdmin } from "@/lib/auth";
import { detectSpecialCommand, matchRule, type Rule } from "@/lib/matching";
import { getActiveRules } from "@/lib/store";
import { pageId } from "../../_lib/data";
import { asTrimmed, bad, fail, ok, readJson } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await readJson(req);
  const text = asTrimmed(body.text);
  if (text === "") return bad("กรุณาพิมพ์ข้อความที่ต้องการทดลอง");

  try {
    // คำสั่งพิเศษมาก่อนกติกาเสมอ — ตัดจบตรงนี้เลย ไม่ต้องแตะฐานข้อมูล
    const special = detectSpecialCommand(text);
    const rules: Rule[] = special ? [] : await getActiveRules(pageId());
    const hit = special ? null : matchRule(text, rules);

    return ok({
      specialCommand: special,
      matchedRule: hit
        ? { id: hit.id, name: hit.name, action: hit.action, pattern: hit.pattern }
        : null,
      explain: special
        ? `ข้อความนี้ถูกจับเป็น “คำสั่งพิเศษ” (${special}) ซึ่งมาก่อนกติกาทุกข้อ`
        : hit
          ? `จะโดนกติกา “${hit.name}” แล้วทำการ “${hit.action}”`
          : "ไม่มีกติกาข้อไหนจับ — บอตจะไปหาคำตอบจากคำถามที่ถามบ่อยและฐานความรู้ต่อ",
    });
  } catch (err) {
    return fail("rules-test", err, "ทดลองจับคู่ไม่สำเร็จ");
  }
}
