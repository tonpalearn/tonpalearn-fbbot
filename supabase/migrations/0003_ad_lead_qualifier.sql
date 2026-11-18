-- ─────────────────────────────────────────────────────────────────────────
-- 0003 · โฟลว์คัดลูกค้าจากแอด Messenger
-- เพิ่มช่องให้ตาราง leads เก็บผลคัดลูกค้า (ปุ่มที่กด · กลุ่ม · คำตอบรายช่อง · LINE)
-- ⚠️ ต้องรันไฟล์นี้ "ก่อน" deploy โค้ดกิ่ง feat/ad-lead-qualifier
--    ไม่งั้นการบันทึกผู้สนใจจากแอดจะล้ม (โค้ดกันไว้ให้ลูกค้าไม่ค้าง แต่ข้อมูลจะอยู่แค่ในแชท+LINE)
--    และหน้าแอดมิน "ผู้สนใจ" จะอ่านรายการไม่ขึ้น เพราะเลือกคอลัมน์ใหม่
-- รันซ้ำได้ (if not exists) · ไม่แตะข้อมูลเดิม
-- ─────────────────────────────────────────────────────────────────────────

alter table leads add column if not exists source        text;                          -- messenger_ad | null (โฟลว์เดิม)
alter table leads add column if not exists segment       text;                          -- big | small | self_learn | details
alter table leads add column if not exists line_id       text;
alter table leads add column if not exists qualification jsonb not null default '{}'::jsonb;

create index if not exists idx_leads_source on leads (page_id, source, created_at desc);

-- RLS เปิดอยู่แล้วตั้งแต่ 0001 (คอลัมน์ใหม่ใช้นโยบายเดียวกัน: เข้าได้เฉพาะ service role)
