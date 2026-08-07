# คู่มือขึ้นระบบจริง — FB Page Chatbot (TONPALEARN)

> ทำตามลำดับ ทีละข้อ ข้ามไม่ได้ · ใช้เวลาประมาณ 45–60 นาทีถ้าทุกบัญชีพร้อม
> ทุกครั้งที่เห็นคำว่า **คัดลอกเก็บไว้** ให้เอาค่าไปใส่ในไฟล์ `.env.local` (ตอนทดสอบ) และใน Vercel (ตอนขึ้นจริง)

---

## ขั้นที่ 1 — เตรียมฐานข้อมูล Supabase

1. เข้า supabase.com → **New project** → ตั้งชื่อ `fb-page-chatbot` → เลือกภูมิภาค **Southeast Asia (Singapore)** (ใกล้ไทยที่สุด)
2. รอสร้างเสร็จ (~2 นาที) แล้วไปที่ **SQL Editor**
3. เปิดไฟล์ `supabase/migrations/0001_init.sql` คัดลอกทั้งไฟล์ → วาง → กด **Run**
   ต้องขึ้น `Success. No rows returned`
4. เปิด `supabase/migrations/0002_seed.sql` → **แทนที่ `:page_id` ทุกจุดด้วยไอดีเพจจริง** (ได้จากขั้นที่ 2) → วาง → **Run**
   ข้ามข้อนี้ไปก่อนได้ แล้วค่อยกลับมาทำหลังได้ไอดีเพจ
   > ไฟล์นี้เพิ่มแถวเพจลงตาราง `fb_pages` ด้วย ซึ่งเป็นตัวที่ทำให้ **สวิตช์ปิดบอต** ในหน้าตั้งค่าใช้งานได้
5. ไปที่ **Project Settings → API** แล้ว **คัดลอกเก็บไว้**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ ตัวนี้ห้ามหลุดออกไปฝั่งเบราว์เซอร์เด็ดขาด

---

## ขั้นที่ 2 — สร้างแอปบน Facebook

1. เข้า developers.facebook.com → **My Apps → Create App**
2. เลือกประเภท **Business** → ตั้งชื่อแอป เช่น `TONPALEARN Chatbot`
3. หน้า Dashboard → **App settings → Basic** → **คัดลอกเก็บไว้**:
   - `App Secret` (กด Show) → `FB_APP_SECRET`
4. กลับหน้า Dashboard → หา **Messenger** → **Set up**
5. ในหน้า Messenger → **Generate access token**:
   - เลือกเพจ TONPALEARN → กด **Generate**
   - **คัดลอกเก็บไว้** → `FB_PAGE_ACCESS_TOKEN`
   - ไอดีเพจที่แสดงคู่กัน → `FB_PAGE_ID`
6. ตั้ง `FB_VERIFY_TOKEN` เป็นสตริงอะไรก็ได้ที่คุณคิดเอง (ยาว ๆ สุ่ม ๆ) — จะใช้ในขั้นที่ 4

> ⚠️ **ตรวจก่อน — เรื่องนี้มีวันหมดอายุ:** เปิด developers.facebook.com/docs/graph-api/changelog
> ดูว่าเวอร์ชันปัจจุบันคืออะไร แล้วตั้ง `GRAPH_API_VERSION` ให้ตรง
> ค่าตั้งต้นในโค้ดคือ `v21.0` ซึ่งออกเดือนตุลาคม 2024 — Meta ให้อายุแต่ละเวอร์ชันราว 2 ปี
> **แปลว่ามันใกล้หมดอายุแล้ว และวันที่หมด การส่งข้อความจะตายพร้อมกันทั้งระบบ**
> ตั้งเตือนในปฏิทินไว้ปีละครั้งเพื่อเลื่อนเวอร์ชัน

---

## ขั้นที่ 3 — ขึ้นเว็บบน Vercel

1. push โค้ดขึ้น GitHub (repo ส่วนตัว)
2. เข้า vercel.com → **Add New → Project** → เลือก repo นี้
3. ก่อนกด Deploy ให้ใส่ **Environment Variables** ทั้งหมดตาม `.env.example`:
   ```
   FB_APP_SECRET, FB_VERIFY_TOKEN, FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN, GRAPH_API_VERSION,
   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
   GEMINI_API_KEY, GEMINI_MODEL,
   ADMIN_PASSCODE, ADMIN_SESSION_SECRET, NEXT_PUBLIC_APP_URL
   ```
   - `ADMIN_SESSION_SECRET` สร้างด้วยคำสั่ง: `openssl rand -hex 32`
   - `ADMIN_PASSCODE` ตั้งเองให้ยาว **อย่างน้อย 16 ตัว** (โค้ดบังคับไว้ สั้นกว่านี้ระบบจะไม่ยอมทำงาน)
   - `GEMINI_API_KEY` เอาจาก **aistudio.google.com/apikey** → Get API key
   - ติ๊กให้ครบทั้ง **Production · Preview · Development** ทั้ง 3 ช่อง
4. กด **Deploy** → ได้ URL เช่น `https://fb-chatbot-xxx.vercel.app`
5. เปิด `https://<โดเมนของคุณ>/api/health` → ต้องขึ้น `"status": "พร้อมใช้งาน"`
   ถ้าขึ้น `ยังตั้งค่าไม่ครบ` จะบอกชื่อตัวแปรที่ขาดให้เลย

---

## ขั้นที่ 4 — ต่อ webhook เข้ากับเพจ

1. กลับไปหน้า Messenger ในแอป Facebook → หัวข้อ **Webhooks** → **Add Callback URL**
2. กรอก:
   - **Callback URL**: `https://<โดเมนของคุณ>/api/webhook/facebook`
   - **Verify Token**: ค่าเดียวกับ `FB_VERIFY_TOKEN`
3. กด **Verify and Save** → ต้องผ่านทันที (ถ้าไม่ผ่าน แปลว่า env ยังไม่ตรง — เช็ก `/api/health` ก่อน)
4. กด **Add subscriptions** แล้วติ๊ก:
   `messages` · `messaging_postbacks` · `messaging_optins` · `messaging_handovers` · `message_echoes`
5. ในหัวข้อ **Access Tokens** ตรงเพจ ให้กด **Add Subscriptions** เพื่อผูกเพจกับแอปนี้

6. **ตั้งแอปนี้เป็นผู้รับหลักของเพจ (Primary Receiver) — ห้ามข้าม**
   ถ้าไม่ตั้ง การโอนสายให้คนจะล้มทุกครั้ง (ลูกค้าจะได้ยินว่า "กำลังเรียกทีมงาน" แต่แชทไม่ไปโผล่ที่ไหน)
   - ไปที่ **Meta Business Suite → การตั้งค่า (Settings) → ข้อความอัตโนมัติ / Advanced Messaging** ของเพจ
   - ในหัวข้อ **Handover Protocol** ตั้ง:
     - **Primary Receiver** = แอปของเรา (`TONPALEARN Chatbot`)
     - **Secondary Receiver** = **Page Inbox** (Meta Business Suite)
   - ความหมาย: บอตถือสายเป็นค่าตั้งต้น และส่งต่อให้คนเมื่อจำเป็น
   > ตรวจว่าตั้งสำเร็จไหม: ทักคำว่า "ขอคุยกับคน" เข้าเพจ แล้วแชทต้องเด้งไปโผล่ใน Meta Business Suite
   > ถ้าไม่โผล่ ให้เปิดหน้าแอดมิน → กล่องข้อความ จะเห็นข้อความสีเทาจากระบบบอกว่าโอนไม่สำเร็จ

---

## ขั้นที่ 5 — ตั้งปุ่มเริ่มต้นและเมนูค้าง (ทำครั้งเดียว)

รันคำสั่งนี้จากเครื่องคุณ (แทนค่า 2 จุด):

```bash
curl -X POST "https://graph.facebook.com/v21.0/PAGE_ID/messenger_profile?access_token=PAGE_ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"get_started":{"payload":"GET_STARTED"},"persistent_menu":[{"locale":"default","composer_input_disabled":false,"call_to_actions":[{"type":"postback","title":"คอร์สที่เปิดอยู่","payload":"MENU_COURSES"},{"type":"postback","title":"จัดอบรมในองค์กร","payload":"MENU_CORPORATE"},{"type":"postback","title":"คุยกับทีมงาน","payload":"MENU_HUMAN"}]}]}'
```

---

## ขั้นที่ 6 — กรอกเนื้อหาจริงก่อนเปิดให้คนนอกใช้

1. เข้า `https://<โดเมนของคุณ>/admin` → ใส่ `ADMIN_PASSCODE`
2. ไปหน้า **คำถามที่ถามบ่อย** → แก้ทุกข้อที่ขึ้นป้าย `[กรอกเอง]` ให้เป็นข้อมูลจริง
   ⚠️ **ข้อนี้ห้ามข้าม** — บอตจะไม่ใช้คำตอบที่ยังเป็น `[กรอกเอง]` แต่มันจะไปโยนให้คนตอบแทนทุกครั้ง
3. ไปหน้า **ฐานความรู้** → วางรายละเอียดคอร์ส/เงื่อนไข/คำถามที่ตอบยาว ๆ
4. ไปหน้า **ตั้งค่า** → แก้ข้อความทักทาย/ข้อความส่งต่อ/เวลาทำการ ให้เป็นเสียงของเพจจริง

---

## ขั้นที่ 7 — ทดสอบจริงก่อนเปิด

ทดสอบด้วยบัญชี Facebook ที่เป็น **แอดมิน/ผู้ทดสอบของแอป** (ตอนแอปยังอยู่โหมด Development คนนอกจะคุยกับบอตไม่ได้)

| ทดสอบ | ต้องได้ผลว่า |
|---|---|
| ทักคำว่า "สวัสดี" | บอตทักกลับพร้อมปุ่มเมนู |
| ถามคำถามที่มีใน FAQ | ตอบตรงจากคำตอบที่กรอกไว้ |
| ถามเรื่องที่มีในฐานความรู้ | ตอบโดยอ้างเนื้อหาที่วางไว้ ไม่แต่งตัวเลขเอง |
| พิมพ์ "สนใจครับ" | บอตถามชื่อ → เบอร์ → ความสนใจ แล้วบันทึกลงหน้า **ผู้สนใจ** |
| พิมพ์ "ขอคุยกับคน" | บอตแจ้งว่าเรียกทีมงาน แล้ว **เงียบ** · แชทไปโผล่ใน Meta Business Suite |
| ตอบจากหน้าแอดมิน | ข้อความไปถึงลูกค้าจริง |
| กด "คืนให้บอต" | บอตกลับมาตอบได้อีกครั้ง |
| ถามเรื่องที่ไม่มีข้อมูลเลย | บอตไม่มั่ว แต่เสนอส่งต่อให้คน |

---

## ขั้นที่ 8 — ขอสิทธิ์เพื่อเปิดให้คนทั่วไป (App Review)

ต้องขอสิทธิ์เหล่านี้: `pages_messaging` · `pages_manage_metadata` · `pages_show_list` · `pages_read_engagement`

สิ่งที่ Facebook มักขอ: วิดีโอหน้าจอแสดงการใช้งานจริงตั้งแต่ลูกค้าทัก → บอตตอบ → โอนหาคน, คำอธิบายว่าใช้ข้อมูลทำอะไร, และนโยบายความเป็นส่วนตัวที่เข้าถึงได้จริง

> ระหว่างรอผลรีวิว ระบบยังใช้งานได้ปกติกับบัญชีที่เป็นแอดมิน/ผู้ทดสอบของแอป

---

## เมื่อมีปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| Verify webhook ไม่ผ่าน | `FB_VERIFY_TOKEN` ใน Vercel ไม่ตรงกับที่กรอกในหน้า Facebook |
| กด "ขอคุยเอง" แล้วขึ้น error `(#27) Take thread control is not supported when conversation routing is not enabled` | เพจยังไม่ได้ตั้ง Primary/Secondary Receiver (ขั้นที่ 4 ข้อ 6) — เปิดแล้วจะกดได้ทันที ไม่ต้อง deploy ใหม่ |
| ตอบจากหน้าแอดมินแล้วขึ้น error `(#10) another app is controlling this thread` | สายอยู่กับ Page Inbox — กด "ขอคุยเอง" ก่อนเพื่อดึงสายกลับ แล้วค่อยพิมพ์ตอบ (หรือไปตอบใน Meta Business Suite แทน) |
| บอตเงียบสนิท | ลืมกด **Add Subscriptions** ตรงเพจ · หรือแชทนั้นอยู่สถานะ `human_active` |
| ขึ้น 401 ลายเซ็นไม่ถูกต้อง | `FB_APP_SECRET` ผิด หรือคัดลอกมาไม่ครบ |
| ส่งข้อความจากหน้าแอดมินไม่ได้ | เลยหน้าต่าง 24 ชั่วโมงนับจากข้อความล่าสุดของลูกค้า |
| บอตตอบว่าไม่รู้ตลอด | คำตอบใน FAQ ยังเป็น `[กรอกเอง]` หรือฐานความรู้ยังว่าง |
