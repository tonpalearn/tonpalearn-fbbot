/**
 * แอดมินพิมพ์ตอบลูกค้าเอง
 *
 * เรื่อง 24 ชั่วโมง: Facebook ยอมให้ตอบข้อความธรรมดาได้ภายใน 24 ชั่วโมง
 * นับจากข้อความล่าสุดของลูกค้า เลยจากนั้นต้องใช้ป้ายกำกับ (message tag)
 * เราลองส่งด้วย HUMAN_AGENT ให้ แต่ถ้าเพจยังไม่ได้รับสิทธิ์นั้นก็จะส่งไม่ผ่าน
 * — กรณีนั้นต้องบอกสาเหตุให้แอดมินเข้าใจ ไม่ใช่ขึ้นแค่คำว่า error
 */
import { requireAdmin } from "@/lib/auth";
import { sendText } from "@/lib/facebook";
import { saveMessage, updateConversation } from "@/lib/store";
import { getConversationPsid, pageId } from "../../../_lib/data";
import { asTrimmed, bad, fail, ok, readJson } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await readJson(req);
  const text = asTrimmed(body.text);

  if (text === "") return bad("ยังไม่ได้พิมพ์ข้อความที่จะส่ง");
  if (text.length > 4000) return bad("ข้อความยาวเกินไป (จำกัด 4,000 ตัวอักษร)");

  let target: { psid: string; lastUserMessageAt: string | null } | null;
  try {
    target = await getConversationPsid(id);
  } catch (err) {
    return fail("reply-lookup", err, "อ่านข้อมูลบทสนทนาไม่สำเร็จ");
  }
  if (!target) return bad("ไม่พบบทสนทนานี้ หรือยังไม่รู้จักผู้ใช้ปลายทาง", 404);

  const lastAt = target.lastUserMessageAt ? new Date(target.lastUserMessageAt).getTime() : 0;
  const outsideWindow = !Number.isFinite(lastAt) || lastAt === 0 || Date.now() - lastAt > WINDOW_MS;

  try {
    await sendText(target.psid, text, outsideWindow ? { tag: "HUMAN_AGENT" } : {});
  } catch (err) {
    console.error(`[admin:reply] ส่งข้อความไม่สำเร็จ: ${(err as Error).message}`);
    if (outsideWindow) {
      return bad(
        "ส่งไม่สำเร็จ เพราะเลย 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้าแล้ว " +
          "ระบบลองส่งแบบ “เจ้าหน้าที่ติดต่อกลับ” (HUMAN_AGENT) ให้แล้วแต่ Facebook ปฏิเสธ " +
          "ซึ่งมักเกิดจากเพจยังไม่ได้รับสิทธิ์นี้ — ทางออกคือรอให้ลูกค้าทักเข้ามาใหม่ " +
          "หรือติดต่อกลับทางเบอร์/อีเมลที่เก็บไว้ในหน้าผู้สนใจครับ",
        422,
      );
    }
    return bad(
      "ส่งข้อความไม่สำเร็จ Facebook ปฏิเสธคำขอ ลองใหม่อีกครั้ง " +
        "ถ้ายังไม่ได้ให้ตรวจว่าโทเคนของเพจยังใช้ได้อยู่ครับ",
      502,
    );
  }

  try {
    await saveMessage({
      conversationId: id,
      pageId: pageId(),
      direction: "out",
      sender: "admin",
      content: text,
      answerSource: "admin",
    });
    // แอดมินลงมือตอบเองแล้ว = คนรับช่วงต่อ บอตต้องหยุดแย่งตอบทันที
    // (กดปุ่ม "คืนให้บอต" เมื่อคุยจบ)
    await updateConversation(id, { unread_for_admin: false, state: "human_active" });
  } catch (err) {
    // ส่งออกไปแล้วแต่บันทึกไม่ลง — บอกตามตรง ไม่หลอกว่าเรียบร้อยทุกอย่าง
    return fail("reply-save", err, "ส่งข้อความให้ลูกค้าแล้ว แต่บันทึกลงประวัติไม่สำเร็จ");
  }

  return ok({ ok: true, usedHumanAgentTag: outsideWindow });
}
