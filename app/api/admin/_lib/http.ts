/**
 * ตัวช่วยเล็ก ๆ ที่ทุก route ของแอดมินใช้ร่วมกัน
 * ทุกข้อความผิดพลาดเป็นภาษาไทย เพราะหน้าเว็บเอาไปแสดงตรง ๆ
 */

export function ok(data: unknown): Response {
  return Response.json(data);
}

export function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/**
 * แปลงข้อผิดพลาดที่ไม่คาดคิดเป็น 500 พร้อมข้อความไทย
 * หมายเหตุความเป็นส่วนตัว: log แค่ชื่อ route กับข้อความของ error เท่านั้น
 * ห้าม log เนื้อหาที่ลูกค้าพิมพ์เข้ามาเด็ดขาด
 */
export function fail(where: string, err: unknown, message: string): Response {
  const detail = err instanceof Error ? err.message : "ไม่ทราบสาเหตุ";
  console.error(`[admin:${where}] ${detail}`);
  return Response.json({ error: message }, { status: 500 });
}

/** อ่าน JSON จาก request แบบไม่ให้ล้มถ้า body เพี้ยน */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function asTrimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function asInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
