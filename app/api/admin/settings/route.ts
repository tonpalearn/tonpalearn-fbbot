/**
 * ข้อความระบบที่แอดมินแก้เองได้ + สวิตช์เปิด/ปิดบอตทั้งเพจ
 */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { pageId } from "../_lib/data";
import { bad, fail, ok, readJson } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** คีย์ที่ยอมให้แก้ผ่านหน้าเว็บ — กันการยัดคีย์แปลกปลอมเข้ามา */
export const EDITABLE_KEYS = [
  "greeting",
  "fallback",
  "handoff_notice",
  "consent_notice",
  "office_hours",
  "bot_persona",
] as const;

const LABELS: Record<string, string> = {
  greeting: "ข้อความทักทาย",
  fallback: "ข้อความเมื่อบอตตอบไม่ได้",
  handoff_notice: "ข้อความตอนโอนหาคน",
  consent_notice: "ข้อความขออนุญาตเก็บข้อมูล",
  office_hours: "เวลาทำการ",
  bot_persona: "บุคลิกของบอต (ใช้สั่งโมเดล)",
};

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const [settings, page] = await Promise.all([
      db().from("settings").select("key,value").in("key", [...EDITABLE_KEYS]),
      db().from("fb_pages").select("page_id,page_name,bot_enabled").eq("page_id", pageId()).maybeSingle(),
    ]);
    if (settings.error) throw settings.error;

    const map = new Map(
      ((settings.data ?? []) as { key: string; value: { text?: string } }[]).map((r) => [
        r.key,
        r.value?.text ?? "",
      ]),
    );

    return ok({
      items: EDITABLE_KEYS.map((k) => ({ key: k, label: LABELS[k], text: map.get(k) ?? "" })),
      botEnabled: page.data?.bot_enabled ?? true,
      pageRegistered: Boolean(page.data),
    });
  } catch (err) {
    return fail("settings-get", err, "อ่านค่าตั้งค่าไม่สำเร็จ");
  }
}

export async function PUT(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await readJson(req);
  const updates = body.items;

  try {
    if (Array.isArray(updates)) {
      const rows = updates
        .filter(
          (u): u is { key: string; text: string } =>
            typeof u === "object" &&
            u !== null &&
            typeof (u as { key?: unknown }).key === "string" &&
            typeof (u as { text?: unknown }).text === "string",
        )
        .filter((u) => (EDITABLE_KEYS as readonly string[]).includes(u.key))
        .map((u) => ({
          key: u.key,
          value: { text: u.text.trim() },
          updated_at: new Date().toISOString(),
        }));

      if (rows.length === 0 && typeof body.botEnabled !== "boolean") {
        return bad("ไม่มีข้อมูลที่จะบันทึก");
      }
      if (rows.length > 0) {
        const { error } = await db().from("settings").upsert(rows, { onConflict: "key" });
        if (error) throw error;
      }
    }

    if (typeof body.botEnabled === "boolean") {
      // ใช้ upsert ไม่ใช่ update — ถ้ายังไม่มีแถวของเพจนี้ update จะไม่โดนอะไรเลย
      // แต่หน้าเว็บจะขึ้นว่า "บันทึกเรียบร้อย" ทั้งที่สวิตช์ปิดบอตไม่ทำงาน
      const { error } = await db()
        .from("fb_pages")
        .upsert(
          { page_id: pageId(), page_name: "TONPALEARN", bot_enabled: body.botEnabled },
          { onConflict: "page_id" },
        );
      if (error) throw error;
    }

    return ok({ ok: true });
  } catch (err) {
    return fail("settings-put", err, "บันทึกค่าตั้งค่าไม่สำเร็จ");
  }
}
