"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const params = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        return;
      }
      // ใช้การโหลดหน้าใหม่ทั้งหน้า ไม่ใช่ router.push
      // เหตุผล: เพิ่งตั้งคุกกี้เสร็จหมาด ๆ ถ้าเปลี่ยนหน้าแบบไม่โหลดใหม่
      // เบราว์เซอร์อาจดึงหน้าเก่าจากแคชของ CDN ที่ยังไม่รู้จักคุกกี้ แล้วเด้งเป็น 404
      const next = params.get("next");
      // กันไม่ให้ถูกพาไปเว็บอื่นผ่านพารามิเตอร์ next
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
      window.location.assign(target);
    } catch {
      setError("ต่อกับเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้งครับ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-7" style={{ boxShadow: "var(--shadow-m)" }}>
        <p className="eyebrow">TONPALEARN</p>
        <h1 className="mt-1 mb-1 text-[1.6rem] font-semibold">ผู้ช่วยตอบแชท</h1>
        <p className="soft mb-5 text-[0.95rem]">หน้าผู้ดูแล — เข้าสู่ระบบด้วยรหัสผ่านของทีม</p>

        <label className="block">
          <span className="mb-1 block font-medium">รหัสผ่าน</span>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="กรอกรหัสผ่านของทีม"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-[0.95rem]" style={{ color: "var(--red)" }}>
            {error}
          </p>
        )}

        <button type="submit" className="btn-gold mt-5 w-full" disabled={busy}>
          {busy ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="soft p-10 text-center">กำลังโหลด...</main>}>
      <LoginForm />
    </Suspense>
  );
}
