/**
 * แจ้งต้นเมื่อได้ผู้สนใจใหม่ (FR-15) ผ่าน LINE Messaging API แบบ push
 *
 * ต้องมีทั้ง LINE_CHANNEL_ACCESS_TOKEN และ LINE_NOTIFY_TO (userId ของต้นใน OA นั้น)
 * ขาดตัวใดตัวหนึ่ง = ข้ามเงียบ ๆ — ผู้สนใจยังขึ้นในหน้าแอดมิน "ผู้สนใจ" ตามปกติ
 * ล้มเมื่อไร ห้ามทำให้การตอบลูกค้าล้มตาม และห้าม log เนื้อหาข้อความ (มีเบอร์ลูกค้า)
 */
import { env } from "./env";

export type NotifyResult = "sent" | "skipped" | "failed";

export async function notifyOwner(text: string): Promise<NotifyResult> {
  const token = env.notify.lineToken();
  const to = env.notify.lineTo();
  if (!token || !to) return "skipped";

  try {
    const res = await fetch(`${env.notify.lineBaseUrl()}/v2/bot/message/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // LINE รับข้อความละไม่เกิน 5,000 ตัวอักษร
      body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`[notify] LINE push ไม่สำเร็จ สถานะ ${res.status}`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error(`[notify] LINE push ล้ม: ${(err as Error).name}`);
    return "failed";
  }
}
