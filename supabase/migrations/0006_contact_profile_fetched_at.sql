-- เวลาที่ดึงชื่อ/รูปโปรไฟล์ Messenger ล่าสุด (ลิงก์รูปของ Facebook หมดอายุ → ดึงใหม่ทุก 3 วัน · ล้มแล้วรอ 1 ชม.)
alter table contacts add column if not exists profile_fetched_at timestamptz;
