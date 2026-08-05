"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** สลับสว่าง/มืด — จำไว้ในเครื่องผู้ใช้ ถ้ายังไม่เคยเลือกจะตามค่าของระบบ */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("fbchat_theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    }
  }, []);

  function toggle() {
    const current =
      theme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("fbchat_theme", next);
  }

  return (
    <button
      onClick={toggle}
      className="btn-quiet px-2 py-1 text-[0.9rem]"
      aria-label="สลับโหมดสว่าง/มืด"
      title="สลับโหมดสว่าง/มืด"
    >
      {theme === "dark" ? "☀︎" : "☾"}
    </button>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="btn-quiet w-full"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.push("/admin/login");
        router.refresh();
      }}
    >
      ออกจากระบบ
    </button>
  );
}
