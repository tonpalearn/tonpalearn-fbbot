import Link from "next/link";
import { ThemeToggle, LogoutButton } from "./nav";

/**
 * หน้าหลังบ้านทุกหน้าต้องไม่ถูกเก็บแคชที่ CDN
 * ไม่งั้นเวลาเข้าครั้งแรกหลังล็อกอิน อาจได้หน้าเก่าที่ยังไม่รู้จักคุกกี้ แล้วกลายเป็น 404
 */
export const dynamic = "force-dynamic";

const MENU = [
  { href: "/admin", label: "ภาพรวม" },
  { href: "/admin/inbox", label: "กล่องข้อความ" },
  { href: "/admin/faq", label: "คำถามที่ถามบ่อย" },
  { href: "/admin/rules", label: "กติกา" },
  { href: "/admin/kb", label: "ฐานความรู้" },
  { href: "/admin/leads", label: "ผู้สนใจ" },
  { href: "/admin/settings", label: "ตั้งค่า" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      <aside
        className="border-b p-4 md:min-h-dvh md:w-60 md:shrink-0 md:border-r md:border-b-0"
        style={{ borderColor: "var(--line)", background: "var(--card)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="soft text-[0.8rem] tracking-widest uppercase">TONPALEARN</p>
            <p className="font-semibold">ผู้ช่วยตอบแชท</p>
          </div>
          <ThemeToggle />
        </div>

        <nav className="flex flex-wrap gap-1 md:flex-col">
          {MENU.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="rounded-lg px-3 py-2 hover:bg-[var(--accent-weak)]"
            >
              {m.label}
            </Link>
          ))}
        </nav>

        <div className="mt-4 md:mt-8">
          <LogoutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
