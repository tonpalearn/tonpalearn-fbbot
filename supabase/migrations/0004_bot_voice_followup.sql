-- ─────────────────────────────────────────────────────────────────────────
-- 0004 · ถ้อยคำตาม docs/BOT-VOICE.md + ตามต่ออัตโนมัติ + ร่างตามรอบ 2 + ช่องเวลาว่าง
-- ⚠️ รันหลัง 0003 และ "ก่อน" deploy โค้ดรอบนี้ · รันซ้ำได้
-- ข้อความใน settings/rules: แทนเฉพาะแถวที่ยังเป็นค่า seed เดิมคำต่อคำ — ถ้าต้นแก้เองจากหน้าแอดมินแล้ว จะไม่ทับ
-- office_hours: ไม่แตะ (ต้นยังไม่ยืนยันเวลาจริง · โค้ดรอบนี้ไม่ใช้ค่านี้แล้ว)
-- ─────────────────────────────────────────────────────────────────────────

-- ตามต่ออัตโนมัติ (ส่งได้ไม่เกิน 1 ครั้งต่อห้อง) + ร่างตามรอบ 2 ที่บอตห้ามส่งเอง
alter table conversations add column if not exists followup_sent_at  timestamptz;
alter table conversations add column if not exists followup_variant  text;
alter table conversations add column if not exists followup_draft    text;
alter table conversations add column if not exists followup_draft_at timestamptz;

create index if not exists idx_conversations_followup
  on conversations (state, last_user_message_at)
  where followup_sent_at is null;

-- ช่องเวลาว่างที่ต้นกรอก (บรรทัดละ 1 ช่อง เช่น "อังคาร 25 พ.ย. 10:00") · ว่าง = ทุกคำขอนัดส่งต่อต้น
insert into settings (key, value) values ('meeting_slots', '{"text":""}'::jsonb)
on conflict (key) do nothing;

-- ── ถ้อยคำใหม่ (BOT-VOICE ข้อ 2.6) — แทนเฉพาะค่า seed เดิม ──────────────────
update settings set value = '{"text":"สวัสดีครับ ผมต้น TONPALEARN\nอยากให้ช่วยเรื่องไหนครับ กดเลือกด้านล่างได้เลย"}'::jsonb, updated_at = now()
 where key = 'greeting' and value->>'text' = 'สวัสดีครับ ยินดีต้อนรับสู่ TONPALEARN 🙏 อยากให้ช่วยเรื่องไหนดีครับ';

update settings set value = '{"text":"ข้อนี้ผมตอบเองดีกว่าครับ เดี๋ยวเข้ามาตอบในแชทนี้"}'::jsonb, updated_at = now()
 where key = 'fallback' and value->>'text' = 'ขอโทษครับ ตรงนี้ผมยังตอบแทนไม่ได้ ขอส่งต่อให้ทีมงานมาตอบนะครับ สักครู่ครับ';

update settings set value = '{"text":"เดี๋ยวผมเข้ามาคุยต่อในแชทนี้ครับ"}'::jsonb, updated_at = now()
 where key = 'handoff_notice' and value->>'text' = 'กำลังเรียกทีมงานมาคุยต่อให้ครับ ระหว่างรอ พิมพ์ทิ้งไว้ได้เลยครับ';

update settings set value = '{"text":"ขอเบอร์โทรหรือ LINE ไว้นัดคุยครับ ถ้ายังไม่อยากให้ก็บอกได้"}'::jsonb, updated_at = now()
 where key = 'consent_notice' and value->>'text' = 'ขออนุญาตเก็บชื่อและช่องทางติดต่อไว้เพื่อให้ทีมงานติดต่อกลับเท่านั้นนะครับ ถ้าไม่สะดวก พิมพ์ว่า ไม่สะดวก ได้เลยครับ';

update settings set value = jsonb_build_object('text',
  'คุณพิมพ์แชทแทนต้น เจ้าของเพจ TONPALEARN ใช้สรรพนาม "ผม" ตอบ 1–3 บรรทัด ถามได้ 1 คำถามต่อข้อความ '
  || 'ห้ามขึ้นต้นด้วยคำทักทายหรือคำขอบคุณซ้ำ ห้ามบอกเหตุผลของการถาม ห้ามใช้คำว่า ยินดีอย่างยิ่ง / เพื่อให้ข้อมูลได้ตรงจุด / '
  || 'หวังว่าจะเป็นประโยชน์ / ขออนุญาต ห้ามสัญญาผลลัพธ์หรือเวลา ใช้ตัวเลขได้เฉพาะที่อยู่ในเนื้อหาอ้างอิง '
  || 'ถ้าลูกค้าถามว่าคุยกับบอทหรือคน ให้ตอบว่าเป็นระบบตอบอัตโนมัติ'), updated_at = now()
 where key = 'bot_persona' and value->>'text' = 'คุณคือผู้ช่วยตอบแชทของเพจ TONPALEARN ซึ่งสอนการใช้ AI ให้คนทำงานและองค์กร พูดจาสุภาพ กระชับ เป็นกันเอง ลงท้ายว่า ครับ';

update rules set reply_text = 'ได้ครับ ขอบคุณครับ สนใจเมื่อไรทักมาได้เลย'
 where name = 'ไม่สนใจ' and reply_text = 'ได้ครับ ขอบคุณที่แวะเข้ามานะครับ ถ้าสนใจเมื่อไรทักมาได้เลยครับ 🙏';

update rules set pattern = '(คุยกับคน|คุยกับแอดมิน|ขอแอดมิน|เรียกแอดมิน|ต่อแอดมิน|คุยกับต้น|คุยกับคนจริง|ขอคุยกับต้น)'
 where name = 'ขอคุยกับคน' and pattern = '(คุยกับคน|คุยกับแอดมิน|ขอแอดมิน|เรียกแอดมิน|ต่อแอดมิน)';
