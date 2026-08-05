import { checkEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ตรวจว่าค่าตั้งค่าครบไหม — เปิดหลัง deploy เพื่อดูว่าลืมใส่ตัวไหน (ไม่เปิดเผยค่าจริง) */
export async function GET() {
  const { ok, missing } = checkEnv();
  return Response.json(
    {
      status: ok ? "พร้อมใช้งาน" : "ยังตั้งค่าไม่ครบ",
      missing,
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
