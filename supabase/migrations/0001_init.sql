-- ─────────────────────────────────────────────────────────────────────────
-- FB Page Chatbot (TONPALEARN) — โครงฐานข้อมูลตั้งต้น
-- รันบน Supabase: SQL Editor → วางทั้งไฟล์ → Run
-- หลักการ: เปิด RLS ทุกตารางและไม่ให้สิทธิ์ anon เลย
--          ทุกการเข้าถึงผ่านฝั่งเซิร์ฟเวอร์ด้วย service role key เท่านั้น
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_trgm;   -- ค้นข้อความคล้าย ๆ กัน (ใช้ได้กับภาษาไทย)
create extension if not exists vector;    -- เผื่อค้นด้วยเวกเตอร์ในอนาคต

-- ── เพจที่ระบบดูแล (เผื่อรองรับหลายเพจในอนาคต แต่รอบนี้มีแถวเดียว) ──────
create table if not exists fb_pages (
  id            uuid primary key default gen_random_uuid(),
  page_id       text not null unique,                 -- ไอดีเพจจาก Facebook
  page_name     text not null,
  is_active     boolean not null default true,
  bot_enabled   boolean not null default true,        -- สวิตช์ปิดบอตทั้งเพจ
  created_at    timestamptz not null default now()
);

-- ── คนที่ทักเข้ามา ─────────────────────────────────────────────────────
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  page_id       text not null,
  psid          text not null,                        -- Page-Scoped ID ของผู้ใช้
  first_name    text,
  last_name     text,
  profile_pic   text,
  locale        text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (page_id, psid)
);
create index if not exists idx_contacts_last_seen on contacts (last_seen_at desc);

-- ── บทสนทนา (หนึ่งคนต่อหนึ่งห้อง) ───────────────────────────────────────
-- state: bot_active | collecting_lead | awaiting_human | human_active | closed
create table if not exists conversations (
  id                    uuid primary key default gen_random_uuid(),
  page_id               text not null,
  contact_id            uuid not null references contacts(id) on delete cascade,
  state                 text not null default 'bot_active',
  lead_step             text,                          -- ขั้นที่กำลังถามอยู่ตอนเก็บข้อมูล
  lead_draft            jsonb not null default '{}'::jsonb,
  last_user_message_at  timestamptz,                   -- ใช้คำนวณหน้าต่าง 24 ชั่วโมง
  last_bot_message_at   timestamptz,
  unread_for_admin      boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint conversations_state_check
    check (state in ('bot_active','collecting_lead','awaiting_human','human_active','closed'))
);
create unique index if not exists idx_conversations_contact on conversations (contact_id);
create index if not exists idx_conversations_state on conversations (state, updated_at desc);

-- ── ข้อความทุกฝั่ง ─────────────────────────────────────────────────────
-- direction: in (ลูกค้าส่งมา) | out (ระบบส่งไป)
-- sender:    user | bot | admin | system
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  page_id         text not null,
  mid             text,                                -- message id จาก Facebook (กันบันทึกซ้ำ)
  direction       text not null,
  sender          text not null,
  content         text,
  attachments     jsonb,
  answer_source   text,                                -- rule | faq | kb_ai | fallback | admin | system
  confidence      numeric(4,3),
  created_at      timestamptz not null default now(),
  constraint messages_direction_check check (direction in ('in','out')),
  constraint messages_sender_check check (sender in ('user','bot','admin','system'))
);
create unique index if not exists idx_messages_mid on messages (mid) where mid is not null;
create index if not exists idx_messages_conv on messages (conversation_id, created_at);

-- ── กันประมวลผลซ้ำ: Facebook ยิง event ซ้ำได้เมื่อไม่ได้รับ 200 ทัน ────
create table if not exists webhook_events (
  id            uuid primary key default gen_random_uuid(),
  event_key     text not null unique,                 -- mid หรือ hash ของ payload
  received_at   timestamptz not null default now(),
  status        text not null default 'processing',   -- processing | done | error
  error_note    text
);
create index if not exists idx_webhook_events_time on webhook_events (received_at desc);

-- ── คำถามที่ถามบ่อย (แอดมินแก้เองได้ในหน้าเว็บ) ─────────────────────────
create table if not exists faq_entries (
  id            uuid primary key default gen_random_uuid(),
  page_id       text not null,
  question      text not null,
  answer        text not null,
  keywords      text[] not null default '{}',
  is_active     boolean not null default true,
  hit_count     integer not null default 0,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_faq_question_trgm on faq_entries using gin (question gin_trgm_ops);
create index if not exists idx_faq_active on faq_entries (page_id, is_active);

-- ── กติกาคำสำคัญ: ตรงแล้วตอบทันที ไม่ต้องเรียกโมเดล ─────────────────────
-- match_type: contains | exact | regex
-- action:     reply | collect_lead | handoff | menu
create table if not exists rules (
  id            uuid primary key default gen_random_uuid(),
  page_id       text not null,
  name          text not null,
  match_type    text not null default 'contains',
  pattern       text not null,
  action        text not null default 'reply',
  reply_text    text,
  quick_replies jsonb,
  priority      integer not null default 100,          -- เลขน้อย = ตรวจก่อน
  is_active     boolean not null default true,
  hit_count     integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint rules_match_type_check check (match_type in ('contains','exact','regex')),
  constraint rules_action_check check (action in ('reply','collect_lead','handoff','menu'))
);
create index if not exists idx_rules_active on rules (page_id, is_active, priority);

-- ── ฐานความรู้: เอกสารยาว ๆ ที่ตัดเป็นท่อน ๆ ให้ AI หยิบไปตอบ ───────────
create table if not exists kb_documents (
  id            uuid primary key default gen_random_uuid(),
  page_id       text not null,
  title         text not null,
  source        text,                                  -- ที่มา เช่น ชื่อไฟล์/URL
  raw_content   text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists kb_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references kb_documents(id) on delete cascade,
  page_id       text not null,
  chunk_index   integer not null,
  content       text not null,
  embedding     vector(1024),                          -- เผื่ออนาคต ยังไม่ใช้ใน MVP
  created_at    timestamptz not null default now()
);
create index if not exists idx_kb_chunks_trgm on kb_chunks using gin (content gin_trgm_ops);
create index if not exists idx_kb_chunks_doc on kb_chunks (document_id, chunk_index);

-- ── ผู้สนใจที่บอตเก็บได้ ────────────────────────────────────────────────
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  page_id         text not null,
  conversation_id uuid references conversations(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  name            text,
  phone           text,
  email           text,
  interest        text,                                -- คอร์สไหน/เรื่องอะไร
  lead_type       text not null default 'individual',  -- individual | corporate
  note            text,
  status          text not null default 'new',         -- new | contacted | won | lost
  consent_at      timestamptz,                         -- เวลาที่ลูกค้ายินยอมให้เก็บข้อมูล
  created_at      timestamptz not null default now(),
  constraint leads_type_check check (lead_type in ('individual','corporate')),
  constraint leads_status_check check (status in ('new','contacted','won','lost'))
);
create index if not exists idx_leads_created on leads (page_id, created_at desc);
create index if not exists idx_leads_status on leads (status);

-- ── บันทึกการโอน/คืนสาย ────────────────────────────────────────────────
create table if not exists handoff_events (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  action          text not null,                       -- pass | take | auto_release
  reason          text,
  actor           text,                                -- bot | admin
  created_at      timestamptz not null default now(),
  constraint handoff_action_check check (action in ('pass','take','auto_release'))
);

-- ── ผู้ดูแลระบบ (รอบนี้ใช้รหัสผ่านเดียวร่วมกัน ตารางนี้เผื่ออนาคต) ──────
create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  display_name  text,
  role          text not null default 'admin',
  created_at    timestamptz not null default now()
);

-- ── ค่าตั้งค่าที่แก้ได้จากหน้าเว็บ ───────────────────────────────────────
create table if not exists settings (
  key           text primary key,
  value         jsonb not null,
  updated_at    timestamptz not null default now()
);

-- ── บันทึกการใช้โมเดล เพื่อคุมค่าใช้จ่าย ─────────────────────────────────
create table if not exists usage_log (
  id              uuid primary key default gen_random_uuid(),
  page_id         text not null,
  conversation_id uuid,
  model           text not null,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  latency_ms      integer,
  created_at      timestamptz not null default now()
);
create index if not exists idx_usage_created on usage_log (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- ฟังก์ชันค้นหา: ใช้ความคล้ายของตัวอักษร (trigram) ซึ่งทำงานกับภาษาไทยได้
-- โดยไม่ต้องตัดคำ และไม่ต้องพึ่งผู้ให้บริการ embedding เจ้าอื่น
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ สำคัญ: ห้ามใช้ similarity() เทียบ "คำถามสั้น" กับ "เนื้อหายาว"
-- เพราะ similarity คิดจากสัดส่วนต่อความยาวรวมทั้งสองฝั่ง
-- คำถาม 25 ตัวอักษร เทียบเนื้อหา 800 ตัวอักษร จะได้คะแนนราว 0.03 เสมอ ต่อให้ตรงทุกคำ
-- ต้องใช้ word_similarity() ซึ่งหา "ช่วงที่ดีที่สุดในเนื้อหายาว" ให้แทน

create or replace function search_faq(p_page_id text, p_query text, p_limit int default 3)
returns table (id uuid, question text, answer text, score real)
language sql stable
as $$
  select f.id, f.question, f.answer,
         greatest(
           -- คำถามกับคำถาม: ยาวพอ ๆ กัน ใช้ similarity ปกติได้
           similarity(f.question, p_query),
           -- คำถามของลูกค้ายาวกว่าคำสำคัญมาก ต้องใช้ word_similarity (ทิศทาง: สั้น -> ยาว)
           coalesce((select max(word_similarity(k, p_query)) from unnest(f.keywords) k), 0),
           -- เจอคำสำคัญตรง ๆ ในข้อความ ถือว่ามั่นใจสูง ไม่ต้องไปคิดสัดส่วนความยาว
           case when exists (
             select 1 from unnest(f.keywords) k
             where k <> '' and p_query ilike '%' || replace(replace(k, '%', '\%'), '_', '\_') || '%'
           ) then 0.75 else 0 end
         ) as score
  from faq_entries f
  where f.page_id = p_page_id
    and f.is_active
    and (
      p_query % f.question
      or word_similarity(f.question, p_query) > 0.3
      or exists (
        select 1 from unnest(f.keywords) k
        where k <> '' and p_query ilike '%' || replace(replace(k, '%', '\%'), '_', '\_') || '%'
      )
    )
  order by score desc
  limit p_limit;
$$;

create or replace function search_kb(p_page_id text, p_query text, p_limit int default 5)
returns table (id uuid, document_id uuid, title text, content text, score real)
language sql stable
as $$
  select c.id, c.document_id, d.title, c.content,
         greatest(
           word_similarity(p_query, c.content),   -- หาช่วงที่ใกล้เคียงที่สุดในท่อนยาว
           word_similarity(p_query, d.title)      -- ชื่อเอกสารตรงก็นับ
         ) as score
  from kb_chunks c
  join kb_documents d on d.id = c.document_id
  where c.page_id = p_page_id
    and d.is_active
    and (p_query <% c.content or p_query <% d.title)
  order by score desc
  limit p_limit;
$$;

-- นับจำนวนครั้งที่กติกา/คำถามถูกใช้ (ไม่ให้กระทบการตอบถ้าพลาด)
create or replace function increment_hit(p_table text, p_id uuid)
returns void
language plpgsql
as $$
begin
  if p_table = 'rules' then
    update rules set hit_count = hit_count + 1 where id = p_id;
  elsif p_table = 'faq_entries' then
    update faq_entries set hit_count = hit_count + 1 where id = p_id;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS: เปิดทุกตาราง และไม่สร้าง policy ให้ anon/authenticated เลย
-- แปลว่าเข้าถึงได้เฉพาะ service role (ฝั่งเซิร์ฟเวอร์ของเรา) เท่านั้น
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'fb_pages','contacts','conversations','messages','webhook_events',
    'faq_entries','rules','kb_documents','kb_chunks','leads',
    'handoff_events','admin_users','settings','usage_log'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

revoke execute on function search_faq(text, text, int) from anon, authenticated;
revoke execute on function search_kb(text, text, int) from anon, authenticated;
revoke execute on function increment_hit(text, uuid) from anon, authenticated;
