import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * ไคลเอนต์ฝั่งเซิร์ฟเวอร์ (service role) — ข้าม RLS ได้
 * ใช้ได้เฉพาะในโค้ดที่รันบนเซิร์ฟเวอร์เท่านั้น ห้าม import เข้าไฟล์ที่มี "use client"
 */
let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(env.supabase.url(), env.supabase.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
