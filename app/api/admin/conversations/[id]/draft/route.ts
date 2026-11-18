/**
 * ร่างตามรอบ 2 ของห้องนี้
 *  POST   { text }  → ต้นกดส่งร่าง (แก้แล้ว) ให้ลูกค้าทาง Messenger แล้วเก็บร่างออกจากคิว
 *  DELETE           → "ส่งเองใน Business Suite แล้ว" / ไม่ใช้ร่างนี้ — เก็บร่างออกจากคิวเฉย ๆ
 *
 * บอตไม่ส่งร่างเองเด็ดขาด — route นี้ทำงานเฉพาะเมื่อแอดมินล็อกอินแล้วกดปุ่มเท่านั้น
 */
import { requireAdmin } from "@/lib/auth";
import { checkDraftSend } from "@/lib/draft-send";
import { sendText } from "@/lib/facebook";
import { saveMessage, updateConversation } from "@/lib/store";
import { getConversationPsid, pageId } from "../../../_lib/data";
import { asTrimmed, bad, fail, ok, readJson } from "../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const text = asTrimmed((await readJson(req)).text);

  let target: { psid: string; lastUserMessageAt: string | null } | null;
  try {
    target = await getConversationPsid(id);
  } catch (err) {
    return fail("draft-lookup", err, "อ่านข้อมูลบทสนทนาไม่สำเร็จ");
  }
  if (!target) return bad("ไม่พบบทสนทนานี้ หรือยังไม่รู้จักผู้ใช้ปลายทาง", 404);

  const check = checkDraftSend(text, target.lastUserMessageAt);
  if (!check.ok) return bad(check.error, check.status);

  try {
    await sendText(target.psid, text, check.useHumanAgentTag ? { tag: "HUMAN_AGENT" } : {});
  } catch (err) {
    console.error(`[admin:draft-send] ส่งไม่สำเร็จ: ${(err as Error).message}`);
    return bad(
      check.useHumanAgentTag
        ? "ส่งไม่สำเร็จ — เลย 24 ชม. แล้ว ระบบลองส่งแบบ “เจ้าหน้าที่ติดต่อกลับ” (HUMAN_AGENT) แต่ Facebook ปฏิเสธ " +
            "มักเกิดจากเพจยังไม่ได้สิทธิ์นี้ — คัดลอกข้อความไปส่งใน Business Suite แทน แล้วกด “ส่งใน Business Suite แล้ว”"
        : "ส่งไม่สำเร็จ Facebook ปฏิเสธคำขอ ลองใหม่อีกครั้ง หรือคัดลอกไปส่งใน Business Suite",
      check.useHumanAgentTag ? 422 : 502,
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
    // ต้นลงมือตามเองแล้ว = คนรับช่วง บอตหยุดตอบ · ร่างออกจากคิวงานวันนี้
    await updateConversation(id, { followup_draft: null, unread_for_admin: false, state: "human_active" });
  } catch (err) {
    return fail("draft-save", err, "ส่งข้อความให้ลูกค้าแล้ว แต่บันทึกลงประวัติไม่สำเร็จ");
  }

  return ok({ ok: true, usedHumanAgentTag: check.useHumanAgentTag });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await params;
  try {
    await updateConversation(id, { followup_draft: null });
  } catch (err) {
    return fail("draft-done", err, "เก็บร่างออกจากคิวไม่สำเร็จ");
  }
  return ok({ ok: true });
}
