import { BottomTabs, Sidebar, TopBar } from "./nav";

/**
 * หน้าหลังบ้านทุกหน้าต้องไม่ถูกเก็บแคชที่ CDN
 * ไม่งั้นเวลาเข้าครั้งแรกหลังล็อกอิน อาจได้หน้าเก่าที่ยังไม่รู้จักคุกกี้ แล้วกลายเป็น 404
 */
export const dynamic = "force-dynamic";

/** จอใหญ่: แถบข้างซ้าย · จอเล็ก: แถบบน + แท็บล่าง (นิ้วโป้งถึง) */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <TopBar />
        <main className="mx-auto w-full max-w-5xl px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">{children}</main>
      </div>
      <BottomTabs />
    </div>
  );
}
