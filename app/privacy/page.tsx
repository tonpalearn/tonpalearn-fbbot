/**
 * นโยบายความเป็นส่วนตัว — Meta บังคับให้มี URL นี้ก่อนยื่น App Review
 * เนื้อหาต้องตรงกับสิ่งที่ระบบทำจริงเท่านั้น (ดู SPEC §13)
 */
export const metadata = {
  title: "นโยบายความเป็นส่วนตัว — ผู้ช่วยตอบแชทเพจ TONPALEARN",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <p className="soft text-sm tracking-widest uppercase">TONPALEARN</p>
      <h1 className="mt-1 mb-2 text-3xl font-semibold">นโยบายความเป็นส่วนตัว</h1>
      <p className="soft mb-8">
        สำหรับระบบผู้ช่วยตอบแชทอัตโนมัติของเพจ Facebook &ldquo;TONPALEARN&rdquo; · ปรับปรุงล่าสุด
        7 สิงหาคม 2569
      </p>

      <section className="space-y-6">
        <div>
          <h2 className="mb-2 text-xl font-semibold">ระบบนี้ทำอะไร</h2>
          <p>
            เมื่อคุณส่งข้อความถึงเพจ TONPALEARN ทาง Facebook Messenger
            ระบบผู้ช่วยอัตโนมัติจะช่วยตอบคำถามเกี่ยวกับคอร์สและบริการของเรา
            และส่งต่อให้ทีมงานที่เป็นคนจริงเมื่อจำเป็น
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-xl font-semibold">ข้อมูลที่เราเก็บ</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>ข้อความที่คุณส่งถึงเพจ และข้อความที่ระบบตอบกลับ</li>
            <li>
              รหัสผู้ใช้ Messenger ของคุณสำหรับเพจนี้ (PSID) ชื่อที่แสดง
              และรูปโปรไฟล์ ตามที่ Facebook เปิดเผยให้เพจ
            </li>
            <li>
              ชื่อ เบอร์โทรศัพท์ หรืออีเมล <strong>เฉพาะเมื่อคุณพิมพ์บอกเราเอง</strong>{" "}
              หลังจากระบบแจ้งขออนุญาตเก็บข้อมูลแล้วเท่านั้น
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-xl font-semibold">เอาไปใช้ทำอะไร</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>ตอบคำถามของคุณเกี่ยวกับคอร์ส ราคา ตารางอบรม และบริการ</li>
            <li>ให้ทีมงานติดต่อกลับตามที่คุณขอไว้</li>
            <li>ปรับปรุงคุณภาพคำตอบของระบบ</li>
          </ul>
          <p className="mt-2">
            เราไม่ขายหรือส่งต่อข้อมูลของคุณให้บุคคลที่สามเพื่อการโฆษณา
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-xl font-semibold">เก็บไว้ที่ไหน นานแค่ไหน</h2>
          <p>
            ข้อมูลถูกเก็บในฐานข้อมูลที่มีการควบคุมการเข้าถึง
            เข้าถึงได้เฉพาะทีมงานของ TONPALEARN
            เราเก็บประวัติการสนทนาไว้ตราบเท่าที่จำเป็นต่อการให้บริการ
            และลบเมื่อได้รับคำขอจากคุณ
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-xl font-semibold">สิทธิ์ของคุณ</h2>
          <p>
            คุณมีสิทธิ์ขอดู แก้ไข หรือลบข้อมูลของคุณได้ทุกเมื่อ ตามพระราชบัญญัติ
            คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA) — ดูวิธีขอลบข้อมูลได้ที่{" "}
            <a href="/data-deletion" className="underline">
              หน้าคำขอลบข้อมูล
            </a>
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-xl font-semibold">ติดต่อเรา</h2>
          <p>
            ส่งข้อความถึงเพจ{" "}
            <a
              href="https://www.facebook.com/tonpalearn"
              className="underline"
              rel="noopener noreferrer"
            >
              TONPALEARN
            </a>{" "}
            ทาง Facebook Messenger แล้วพิมพ์ว่า &ldquo;ขอคุยกับคน&rdquo;
            ทีมงานจะติดต่อกลับโดยเร็วที่สุด
          </p>
        </div>
      </section>
    </main>
  );
}
