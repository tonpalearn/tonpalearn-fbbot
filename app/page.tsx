import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="soft text-sm tracking-widest uppercase">TONPALEARN</p>
      <h1 className="text-3xl leading-snug font-semibold sm:text-4xl">
        ผู้ช่วยตอบแชทเพจ Facebook
      </h1>
      <p className="soft max-w-xl">
        ตอบคำถามที่ถามซ้ำ ๆ ให้ทันทีตลอด 24 ชั่วโมง เก็บชื่อและช่องทางติดต่อของคนที่สนใจไว้ให้
        และโอนสายให้คนจริงเมื่อเกินกำลัง
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/admin" className="btn-gold">
          เข้าหน้าผู้ดูแล
        </Link>
        <Link href="/api/health" className="btn-quiet">
          ตรวจสถานะระบบ
        </Link>
      </div>
    </main>
  );
}
