-- ตามต่ออัตโนมัติทุก 30 นาที ด้วย Supabase pg_cron + pg_net (แทน Vercel Cron · แผน Hobby รันได้วันละครั้ง)
-- รันบนฐานจริงแล้ว 18 พ.ย. 69 · กุญแจอยู่ใน Vault ชื่อ fbbot_cron_secret (ค่าเดียวกับ CRON_SECRET บน Vercel)
-- ห้ามใส่ค่ากุญแจในไฟล์นี้ — สร้างใน Vault ด้วยมือ:  select vault.create_secret('<ค่า>', 'fbbot_cron_secret');
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'fbbot-followup',
  '*/30 * * * *',
  $$select net.http_get(
      url := 'https://tpl-fbbot.vercel.app/api/cron/followup',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fbbot_cron_secret')),
      timeout_milliseconds := 55000
  );$$
);
-- หยุด: select cron.unschedule('fbbot-followup');
-- ดูผล: select status_code, content from net._http_response order by id desc limit 5;
