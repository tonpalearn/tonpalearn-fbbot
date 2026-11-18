/**
 * ตรวจก่อนส่ง "ร่างตามรอบ 2" จากหน้าแอดมิน — ฟังก์ชันบริสุทธิ์ เขียนเทสต์ได้ทุกกิ่ง
 *
 * กติกา (ต้นสั่ง 18 พ.ย. 69 "เพิ่มปุ่มส่ง"):
 *  - คนกดส่งเอง บอตไม่ส่งเอง (BOT-VOICE 3.6 ยังเหมือนเดิม)
 *  - ห้ามส่งถ้ายังมีช่องว่างให้เติม เช่น [ปัญหา] — ลูกค้าจะเห็นวงเล็บเหลี่ยมตรง ๆ
 *  - ส่งได้ภายใน 7 วันนับจากข้อความล่าสุดของลูกค้าเท่านั้น (เพดานของป้าย HUMAN_AGENT ของ Meta)
 *  - เลย 24 ชม. แล้ว → ต้องส่งพร้อมป้าย HUMAN_AGENT
 */
import { DRAFT_WINDOW_MS } from "./today";

export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** ช่องที่ต้องเติมก่อนส่ง: [ข้อความ] หรือ {ข้อความ} */
export function findPlaceholders(text: string): string[] {
  return [...text.matchAll(/\[[^\]\n]{1,40}\]|\{[^}\n]{1,40}\}/g)].map((m) => m[0]);
}

export type DraftCheck =
  | { ok: true; useHumanAgentTag: boolean }
  | { ok: false; status: number; error: string };

export function checkDraftSend(text: string, lastUserMessageAt: string | null, now = new Date()): DraftCheck {
  const t = text.trim();
  if (t === "") return { ok: false, status: 400, error: "ยังไม่มีข้อความที่จะส่ง" };
  if (t.length > 2000) return { ok: false, status: 400, error: "ข้อความยาวเกินไป (จำกัด 2,000 ตัวอักษร)" };
  const holes = findPlaceholders(t);
  if (holes.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `ยังมีช่องที่ต้องเติมก่อนส่ง: ${[...new Set(holes)].join(" ")} — แก้เป็นคำของต้นเองก่อนครับ`,
    };
  }
  const last = lastUserMessageAt ? new Date(lastUserMessageAt).getTime() : NaN;
  if (!Number.isFinite(last)) {
    return { ok: false, status: 422, error: "ไม่รู้เวลาที่ลูกค้าพิมพ์ล่าสุด เลยส่งผ่าน Facebook ไม่ได้ — ติดต่อทางเบอร์หรือ LINE แทน" };
  }
  const age = now.getTime() - last;
  if (age >= DRAFT_WINDOW_MS) {
    return {
      ok: false,
      status: 422,
      error: "เลย 7 วันนับจากข้อความล่าสุดของลูกค้าแล้ว Facebook ไม่ให้เพจส่งข้อความหาแล้ว — ติดต่อทางเบอร์หรือ LINE แทน",
    };
  }
  return { ok: true, useHumanAgentTag: age > MESSAGING_WINDOW_MS };
}
