"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DisplayPanel, DisplayPanelButton, ThemeQuickToggle } from "@/components/display";
import {
  IconBook,
  IconFaq,
  IconInbox,
  IconLeads,
  IconLogout,
  IconMore,
  IconRules,
  IconSettings,
  IconToday,
  IconX,
  IconDisplay,
} from "@/components/icons";

const MAIN = [
  { href: "/admin", label: "งานวันนี้", short: "วันนี้", Icon: IconToday },
  { href: "/admin/inbox", label: "กล่องข้อความ", short: "แชท", Icon: IconInbox },
  { href: "/admin/leads", label: "ผู้สนใจ", short: "ผู้สนใจ", Icon: IconLeads },
];
const SETUP = [
  { href: "/admin/faq", label: "คำถามที่ถามบ่อย", Icon: IconFaq },
  { href: "/admin/rules", label: "กติกา", Icon: IconRules },
  { href: "/admin/kb", label: "ฐานความรู้", Icon: IconBook },
  { href: "/admin/settings", label: "ตั้งค่า", Icon: IconSettings },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <div className="min-w-0">
      <p className="eyebrow">TONPALEARN</p>
      <p className="f-head font-semibold leading-tight">ผู้ช่วยตอบแชท</p>
    </div>
  );
}

function NavLink({ href, label, Icon }: { href: string; label: string; Icon: typeof IconToday }) {
  const active = isActive(usePathname(), href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 font-medium transition-colors"
      style={
        active
          ? { background: "var(--gold-soft)", color: "var(--gold)", boxShadow: "inset 3px 0 0 var(--g2)" }
          : { color: "var(--tx)" }
      }
    >
      <Icon />
      {label}
    </Link>
  );
}

async function logout(router: ReturnType<typeof useRouter>) {
  await fetch("/api/admin/logout", { method: "POST" });
  router.push("/admin/login");
  router.refresh();
}

/** แถบข้างจอใหญ่ (≥ 1024px) */
export function Sidebar() {
  const router = useRouter();
  return (
    <aside
      className="glass-bar sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r p-4 lg:flex"
      style={{ borderColor: "var(--glass-line)" }}
    >
      <div className="mb-5 flex items-center justify-between gap-2 px-1">
        <Brand />
        <ThemeQuickToggle />
      </div>
      <nav aria-label="เมนูหลัก" className="space-y-1">
        {MAIN.map((m) => (
          <NavLink key={m.href} {...m} />
        ))}
      </nav>
      <p className="eyebrow mt-6 mb-2 px-3">ตั้งค่าบอต</p>
      <nav aria-label="ตั้งค่าบอต" className="space-y-1">
        {SETUP.map((m) => (
          <NavLink key={m.href} {...m} />
        ))}
      </nav>
      <div className="mt-auto space-y-1 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <DisplayPanelButton />
        <button type="button" className="btn-ghost w-full justify-start gap-3" onClick={() => logout(router)}>
          <IconLogout /> ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}

/** แถบบนจอเล็ก */
export function TopBar() {
  return (
    <header
      className="glass-bar sticky top-0 z-30 flex items-center justify-between gap-2 border-b px-4 py-2 lg:hidden"
      style={{ borderColor: "var(--glass-line)" }}
    >
      <Brand />
      <div className="flex items-center">
        <ThemeQuickToggle />
        <DisplayPanelButton variant="icon" />
      </div>
    </header>
  );
}

/** แถบแท็บล่างจอเล็ก: 3 หน้าหลัก + "เพิ่มเติม" (ตั้งค่าบอต · การแสดงผล · ออกจากระบบ) */
export function BottomTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const [look, setLook] = useState(false);
  const moreActive = SETUP.some((s) => isActive(pathname, s.href));

  useEffect(() => setMore(false), [pathname]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMore(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [more]);

  const tab = (active: boolean) => ({ color: active ? "var(--gold)" : "var(--tx2)" });

  return (
    <>
      <nav
        aria-label="เมนูหลัก"
        className="glass-bar pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t lg:hidden"
        style={{ borderColor: "var(--glass-line)", boxShadow: "0 -8px 24px -16px rgba(0,0,0,.25)" }}
      >
        {MAIN.map((m) => {
          const active = isActive(pathname, m.href);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={active ? "page" : undefined}
              className="flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[0.8rem] font-medium"
              style={tab(active)}
            >
              <m.Icon size={22} />
              {m.short}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-expanded={more}
          aria-haspopup="dialog"
          className="flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[0.8rem] font-medium"
          style={tab(moreActive)}
        >
          <IconMore size={22} />
          เพิ่มเติม
        </button>
      </nav>

      {more && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden" style={{ background: "var(--scrim)" }} onClick={() => setMore(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="เมนูเพิ่มเติม"
            className="card pb-safe w-full space-y-1 rounded-b-none p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <p className="eyebrow">ตั้งค่าบอต</p>
              <button type="button" className="btn-ghost px-2.5" onClick={() => setMore(false)} aria-label="ปิด">
                <IconX />
              </button>
            </div>
            {SETUP.map((m) => (
              <NavLink key={m.href} {...m} />
            ))}
            <div className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: "var(--line)" }}>
              <button
                type="button"
                className="btn-ghost w-full justify-start gap-3"
                onClick={() => {
                  setMore(false);
                  setLook(true);
                }}
              >
                <IconDisplay /> การแสดงผล
              </button>
              <button type="button" className="btn-ghost w-full justify-start gap-3" onClick={() => logout(router)}>
                <IconLogout /> ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      )}
      {look && <DisplayPanel onClose={() => setLook(false)} />}
    </>
  );
}
