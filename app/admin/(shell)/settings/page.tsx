"use client";

import { useEffect, useState } from "react";
import { api, ErrorBox, Loading, useLoad } from "@/components/ui";

interface SettingItem {
  key: string;
  label: string;
  text: string;
}

interface SettingsResponse {
  items: SettingItem[];
  botEnabled: boolean;
  pageRegistered: boolean;
}

export default function SettingsPage() {
  const { data, error, loading, reload } = useLoad<SettingsResponse>("/api/admin/settings");
  const [items, setItems] = useState<SettingItem[]>([]);
  const [botEnabled, setBotEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setItems(data.items);
      setBotEnabled(data.botEnabled);
    }
  }, [data]);

  async function save() {
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          items: items.map((i) => ({ key: i.key, text: i.text })),
          botEnabled,
        }),
      });
      setOkMsg("บันทึกเรียบร้อยแล้วครับ");
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">ตั้งค่า</h1>

      <div className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">สวิตช์บอต</h2>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={botEnabled}
            onChange={(e) => setBotEnabled(e.target.checked)}
            className="h-5 w-5"
            style={{ width: "1.25rem" }}
          />
          <span>{botEnabled ? "บอตทำงานอยู่" : "ปิดบอตทั้งเพจ (ทุกข้อความจะไม่มีการตอบอัตโนมัติ)"}</span>
        </label>
        {data && !data.pageRegistered && (
          <p className="soft text-[0.95rem]" style={{ color: "#b4691a" }}>
            ยังไม่มีข้อมูลเพจนี้ในฐานข้อมูล — สวิตช์จะยังไม่มีผลจนกว่าจะเพิ่มแถวเพจในตาราง
            <code> fb_pages</code> (ดูขั้นตอนใน docs/DEPLOY.md)
          </p>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="text-lg font-semibold">ข้อความของระบบ</h2>
        <p className="soft text-[0.95rem]">
          เขียนด้วยเสียงของเพจได้เลย บอตจะใช้ข้อความเหล่านี้ตรง ๆ
        </p>
        {items.map((item, idx) => (
          <label key={item.key} className="block">
            <span className="mb-1 block font-medium">{item.label}</span>
            <textarea
              rows={item.key === "bot_persona" ? 4 : 2}
              value={item.text}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...item, text: e.target.value };
                setItems(next);
              }}
            />
          </label>
        ))}
      </div>

      {msg && <ErrorBox message={msg} />}
      {okMsg && <p style={{ color: "#2f7d5d" }}>{okMsg}</p>}

      <button className="btn-gold" onClick={save} disabled={busy}>
        {busy ? "กำลังบันทึก..." : "บันทึกทั้งหมด"}
      </button>
    </div>
  );
}
