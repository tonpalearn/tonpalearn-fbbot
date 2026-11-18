/**
 * ศูนย์รวมค่าตั้งค่าจาก environment
 * กฎ: ทุกค่าที่โค้ดใช้ ต้องผ่านไฟล์นี้ที่เดียว — จะได้รู้ตัวเร็วเมื่อลืมตั้งค่าตอน deploy
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `ยังไม่ได้ตั้งค่า environment variable: ${name} — ดูรายการทั้งหมดใน .env.example`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** ค่าที่อ่านตอนรันจริงเท่านั้น (เรียกฟังก์ชัน ไม่ใช่ค่าคงที่ตอน import) เพื่อให้ build ผ่านแม้ยังไม่ตั้ง env */
export const env = {
  fb: {
    appSecret: () => required("FB_APP_SECRET"),
    verifyToken: () => required("FB_VERIFY_TOKEN"),
    pageId: () => required("FB_PAGE_ID"),
    pageAccessToken: () => required("FB_PAGE_ACCESS_TOKEN"),
    graphVersion: () => optional("GRAPH_API_VERSION", "v21.0"),
    /** ใช้ทดสอบในเครื่องเท่านั้น (ชี้ไปตัวปลอมใน scripts/smoke-local.mjs) — บน prod ห้ามตั้ง */
    graphBaseUrl: () => optional("FB_GRAPH_BASE_URL", "https://graph.facebook.com"),
  },
  supabase: {
    url: () => required("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  },
  gemini: {
    apiKey: () => required("GEMINI_API_KEY"),
    model: () => optional("GEMINI_MODEL", "gemini-3.5-flash"),
    maxTokens: () => num("GEMINI_MAX_TOKENS", 700),
  },
  brain: {
    similarityThreshold: () => num("KB_SIMILARITY_THRESHOLD", 0.35),
    topK: () => num("KB_TOP_K", 5),
    historyTurns: () => num("HISTORY_TURNS", 8),
    dailyAiCallCap: () => num("DAILY_AI_CALL_CAP", 500),
  },
  /** แจ้งต้นเมื่อได้ผู้สนใจใหม่ (FR-15) — ไม่ตั้งค่า = ข้ามเงียบ ๆ ยังเห็นในหน้าแอดมิน */
  notify: {
    lineToken: () => optional("LINE_CHANNEL_ACCESS_TOKEN", ""),
    lineTo: () => optional("LINE_NOTIFY_TO", ""),
    /** ใช้ทดสอบในเครื่องเท่านั้น — บน prod ห้ามตั้ง */
    lineBaseUrl: () => optional("LINE_API_BASE_URL", "https://api.line.me"),
  },
  appUrl: () => optional("NEXT_PUBLIC_APP_URL", "").replace(/\/+$/, ""),
  admin: {
    /**
     * รหัสผ่านหน้าแอดมินคือด่านเดียวจริง ๆ ที่กันคนนอก
     * (ตัวนับความพยายามเดารหัสอยู่ในหน่วยความจำของแต่ละอินสแตนซ์ จึงกันได้ไม่จริงบน Vercel)
     * เลยบังคับความยาวขั้นต่ำตรงนี้แทน
     */
    passcode: () => {
      const v = required("ADMIN_PASSCODE");
      if (v.length < 16) {
        throw new Error(
          "ADMIN_PASSCODE สั้นเกินไป ต้องยาวอย่างน้อย 16 ตัวอักษร " +
            "(หน้าแอดมินเปิดสู่อินเทอร์เน็ต และตัวกันเดารหัสไม่ทำงานข้ามอินสแตนซ์)",
        );
      }
      return v;
    },
    sessionSecret: () => required("ADMIN_SESSION_SECRET"),
  },
} as const;

/** ตรวจว่าค่าที่จำเป็นครบไหม — ใช้ในหน้า /api/health และตอน deploy */
export function checkEnv(): { ok: boolean; missing: string[] } {
  const names = [
    "FB_APP_SECRET",
    "FB_VERIFY_TOKEN",
    "FB_PAGE_ID",
    "FB_PAGE_ACCESS_TOKEN",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
    "ADMIN_PASSCODE",
    "ADMIN_SESSION_SECRET",
  ];
  const missing = names.filter((n) => !process.env[n] || process.env[n]!.trim() === "");
  return { ok: missing.length === 0, missing };
}
