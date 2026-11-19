/**
 * ตัวเชื่อมกับ Facebook Messenger Platform
 * เอกสารอ้างอิง: developers.facebook.com/docs/messenger-platform
 */
import crypto from "node:crypto";
import { env } from "./env";

/** แอปไอดีของ Page Inbox — ใช้ตอนโอนสายให้คนจริงตอบใน Meta Business Suite */
export const PAGE_INBOX_APP_ID = "263902037430900";

const graphBase = () => `${env.fb.graphBaseUrl()}/${env.fb.graphVersion()}`;

/**
 * ตรวจลายเซ็นของ webhook
 * สำคัญ: ต้องส่ง raw body (สตริงดิบ) เข้ามา ห้ามใช้ JSON ที่ parse แล้ว เพราะลำดับ/ช่องว่างจะเปลี่ยน
 */
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const [algo, theirHash] = signatureHeader.split("=");
  if (algo !== "sha256" || !theirHash) return false;

  const ourHash = crypto
    .createHmac("sha256", env.fb.appSecret())
    .update(rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(ourHash, "utf8");
  const b = Buffer.from(theirHash, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b); // เทียบแบบเวลาคงที่ กันการเดาทีละตัวอักษร
}

async function graphPost(path: string, body: unknown): Promise<unknown> {
  const url = `${graphBase()}${path}?access_token=${encodeURIComponent(env.fb.pageAccessToken())}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // ไม่ log ตัวข้อความของลูกค้า — log แค่รหัสข้อผิดพลาดจาก Facebook
    throw new Error(
      `Facebook API ตอบกลับผิดพลาด ${res.status}: ${JSON.stringify(json.error ?? json)}`,
    );
  }
  return json;
}

/** ส่งข้อความตัวอักษรกลับหาลูกค้า (ตัดที่ 2000 ตัวอักษรตามลิมิตของ Messenger) */
export async function sendText(
  recipientId: string,
  text: string,
  opts: { tag?: "HUMAN_AGENT" } = {},
): Promise<void> {
  const chunks = splitForMessenger(text);
  for (const chunk of chunks) {
    await graphPost(`/${env.fb.pageId()}/messages`, {
      recipient: { id: recipientId },
      messaging_type: opts.tag ? "MESSAGE_TAG" : "RESPONSE",
      ...(opts.tag ? { tag: opts.tag } : {}),
      message: { text: chunk },
    });
  }
}

/** ส่งข้อความพร้อมปุ่มตัวเลือกด่วน (quick replies) — สูงสุด 13 ปุ่ม */
export async function sendQuickReplies(
  recipientId: string,
  text: string,
  replies: { title: string; payload: string }[],
): Promise<void> {
  await graphPost(`/${env.fb.pageId()}/messages`, {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: {
      text: text.slice(0, 2000),
      quick_replies: replies.slice(0, 13).map((r) => ({
        content_type: "text",
        title: r.title.slice(0, 20),
        payload: r.payload,
      })),
    },
  });
}

/** บอกลูกค้าว่า "กำลังพิมพ์" หรือ "อ่านแล้ว" */
export async function sendSenderAction(
  recipientId: string,
  action: "typing_on" | "typing_off" | "mark_seen",
): Promise<void> {
  await graphPost(`/${env.fb.pageId()}/messages`, {
    recipient: { id: recipientId },
    sender_action: action,
  });
}

/** โอนสายให้คนจริง — หลังจากนี้บอตต้องเงียบ */
export async function passThreadControl(
  recipientId: string,
  metadata = "โอนจากบอตตามคำขอของลูกค้า",
): Promise<void> {
  await graphPost(`/${env.fb.pageId()}/pass_thread_control`, {
    recipient: { id: recipientId },
    target_app_id: PAGE_INBOX_APP_ID,
    metadata,
  });
}

/** ดึงสายกลับมาให้บอตทำงานต่อ */
export async function takeThreadControl(
  recipientId: string,
  metadata = "คืนสายให้บอต",
): Promise<void> {
  await graphPost(`/${env.fb.pageId()}/take_thread_control`, {
    recipient: { id: recipientId },
    metadata,
  });
}

/** ดึงชื่อ-รูปโปรไฟล์ของผู้ที่ทักมา (เท่าที่ Facebook ยอมให้) */
export async function getUserProfile(
  psid: string,
): Promise<{ first_name?: string; last_name?: string; profile_pic?: string }> {
  const url = `${graphBase()}/${psid}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(
    env.fb.pageAccessToken(),
  )}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const p = (await res.json()) as { first_name?: string; last_name?: string; profile_pic?: string };
      if (p.first_name || p.last_name) return p;
    } else {
      console.error(`[facebook] ดึงโปรไฟล์ไม่สำเร็จ สถานะ ${res.status} — ลองชื่อจากรายการแชทแทน`);
    }
  } catch (err) {
    console.error(`[facebook] ดึงโปรไฟล์ล้ม: ${(err as Error).name}`);
  }
  // ทางสำรอง: ชื่อจากผู้ร่วมแชท (ไม่มีรูป) — ใช้สิทธิ์ pages_messaging เดียวกับที่ export แชท
  try {
    const u = `${graphBase()}/${env.fb.pageId()}/conversations?platform=messenger&user_id=${encodeURIComponent(psid)}&fields=participants&access_token=${encodeURIComponent(env.fb.pageAccessToken())}`;
    const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return {};
    const j = (await res.json()) as { data?: { participants?: { data?: { id: string; name?: string }[] } }[] };
    const me = j.data?.[0]?.participants?.data?.find((x) => x.id === psid);
    if (!me?.name) return {};
    const [first, ...rest] = me.name.trim().split(/\s+/);
    return { first_name: first, last_name: rest.join(" ") || undefined };
  } catch {
    return {};
  }
}

/** ตั้งปุ่ม "เริ่มต้นใช้งาน" + เมนูค้างของเพจ (รันครั้งเดียวตอนติดตั้ง) */
export async function setupMessengerProfile(menuItems: { title: string; payload: string }[]) {
  return graphPost(`/${env.fb.pageId()}/messenger_profile`, {
    get_started: { payload: "GET_STARTED" },
    persistent_menu: [
      {
        locale: "default",
        composer_input_disabled: false,
        call_to_actions: menuItems.slice(0, 3).map((m) => ({
          type: "postback",
          title: m.title.slice(0, 30),
          payload: m.payload,
        })),
      },
    ],
  });
}

/** Messenger รับข้อความละไม่เกิน 2000 ตัวอักษร — ตัดโดยพยายามไม่ให้ประโยคขาดกลางคัน */
export function splitForMessenger(text: string, limit = 2000): string[] {
  const clean = text.trim();
  if (clean.length <= limit) return [clean];

  const out: string[] = [];
  let rest = clean;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > limit * 0.6 ? cut : limit;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}
