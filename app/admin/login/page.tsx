"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
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
      router.push(params.get("next") ?? "/admin");
      router.refresh();
    } catch {
      setError("ต่อกับเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้งครับ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <form onSubmit={submit} className="card w-full max-w-sm p-7">
        <p className="soft text-sm tracking-widest uppercase">TONPALEARN</p>
        <h1 className="mt-1 mb-5 text-2xl font-semibold">หน้าผู้ดูแลแชทบอต</h1>

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
          <p className="mt-3 text-[0.95rem]" style={{ color: "#b3382f" }}>
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
