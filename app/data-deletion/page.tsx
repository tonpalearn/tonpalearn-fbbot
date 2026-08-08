/**
 * วิธีขอลบข้อมูล — Meta บังคับให้แอปมี Data Deletion Instructions URL
 */
export const metadata = {
  title: "คำขอลบข้อมูล — ผู้ช่วยตอบแชทเพจ TONPALEARN",
};

export default function DataDeletionPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <p className="soft text-sm tracking-widest uppercase">TONPALEARN</p>
      <h1 className="mt-1 mb-8 text-3xl font-semibold">วิธีขอลบข้อมูลของคุณ</h1>

      <section className="space-y-6">
        <p>
          หากคุณเคยคุยกับผู้ช่วยตอบแชทของเพจ TONPALEARN
          และต้องการให้เราลบข้อมูลทั้งหมดที่เกี่ยวกับคุณ (ประวัติการสนทนา ชื่อ
          และช่องทางติดต่อที่คุณเคยให้ไว้) ทำได้ 2 ทาง:
        </p>

        <div className="card p-5">
          <h2 className="mb-2 text-lg font-semibold">ทางที่ 1 — ทักเพจโดยตรง (เร็วที่สุด)</h2>
          <ol className="list-decimal space-y-1 pl-6">
            <li>
              เปิดแชทกับเพจ{" "}
              <a
                href="https://www.facebook.com/tonpalearn"
                className="underline"
                rel="noopener noreferrer"
              >
                TONPALEARN
              </a>{" "}
              ใน Messenger
            </li>
            <li>พิมพ์ว่า &ldquo;ขอลบข้อมูลของฉัน&rdquo;</li>
            <li>ทีมงานจะยืนยันตัวตนและลบข้อมูลให้ภายใน 30 วัน พร้อมแจ้งผลกลับ</li>
          </ol>
        </div>

        <div className="card p-5">
          <h2 className="mb-2 text-lg font-semibold">
            ทางที่ 2 — ถอนสิทธิ์ผ่าน Facebook
          </h2>
          <ol className="list-decimal space-y-1 pl-6">
            <li>ไปที่ การตั้งค่า Facebook ของคุณ → แอปและเว็บไซต์</li>
            <li>ค้นหาแอปของ TONPALEARN แล้วกดลบ</li>
            <li>
              จากนั้นแจ้งเราผ่านช่องทางในทางที่ 1
              เพื่อให้ลบข้อมูลที่เก็บไว้ฝั่งเราด้วย
            </li>
          </ol>
        </div>

        <p>
          สิ่งที่จะถูกลบ: ประวัติข้อความทั้งหมด · ชื่อและช่องทางติดต่อที่คุณให้ไว้ ·
          ข้อมูลโปรไฟล์ที่ระบบเก็บจาก Messenger — ลบแล้วกู้คืนไม่ได้
        </p>
      </section>
    </main>
  );
}
