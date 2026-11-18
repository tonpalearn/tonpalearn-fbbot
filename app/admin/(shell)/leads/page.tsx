"use client";

import { useState } from "react";
import { api, Empty, ErrorBox, Loading, thaiTime, useLoad } from "@/components/ui";

interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  line_id: string | null;
  interest: string | null;
  note: string | null;
  conversation_id: string | null;
  source: string | null;
  segment: string | null;
  qualification: {
    button?: string;
    fields?: Record<string, string>;
    reason?: string;
  } | null;
  lead_type: "individual" | "corporate";
  status: "new" | "contacted" | "won" | "lost";
  created_at: string;
}

const STATUS_LABEL: Record<Lead["status"], string> = {
  new: "ใหม่",
  contacted: "ติดต่อแล้ว",
  won: "ปิดได้",
  lost: "ไม่ไปต่อ",
};

const SEGMENT_LABEL: Record<string, string> = {
  big: "แอด · 10 ล้านขึ้นไป",
  small: "แอด · ต่ำกว่า 10 ล้าน",
  self_learn: "แอด · อยากเรียนเอง",
  details: "แอด · ขอตัวอย่างงาน",
};

const FIELD_LABEL: Record<string, string> = {
  business_type: "ธุรกิจ",
  team_size: "ขนาดทีม",
  pain: "อยากให้ AI ช่วย",
  decision_maker: "ตัดสินใจ",
  timeline: "อยากเห็นผล",
  use_case: "อยากใช้ AI กับงาน",
};

const contactOf = (l: Lead) =>
  [l.phone, l.email, l.line_id && `LINE ${l.line_id}`].filter(Boolean).join(" · ");

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "ทั้งหมด" },
  { value: "new", label: "ใหม่" },
  { value: "contacted", label: "ติดต่อแล้ว" },
  { value: "won", label: "ปิดได้" },
  { value: "lost", label: "ไม่ไปต่อ" },
];

export default function LeadsPage() {
  const [status, setStatus] = useState("");
  const path = `/api/admin/leads${status ? `?status=${status}` : ""}`;
  const { data, error, loading, reload } = useLoad<{ items: Lead[] }>(path);
  const [msg, setMsg] = useState<string | null>(null);

  async function setStatusOf(lead: Lead, next: Lead["status"]) {
    setMsg(null);
    try {
      await api(`/api/admin/leads/${lead.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: next }),
      });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  function downloadCsv() {
    const rows = data?.items ?? [];
    const header = ["ชื่อ", "เบอร์", "อีเมล", "LINE", "ปุ่มที่กด", "ความสนใจ", "ประเภท", "สถานะ", "วันที่"];
    const body = rows.map((r) => [
      r.name ?? "",
      r.phone ?? "",
      r.email ?? "",
      r.line_id ?? "",
      r.qualification?.button ?? "",
      r.interest ?? "",
      r.lead_type === "corporate" ? "องค์กร" : "รายบุคคล",
      STATUS_LABEL[r.status],
      new Date(r.created_at).toLocaleString("th-TH"),
    ]);
    // ใส่ ' นำหน้าเซลล์ที่ขึ้นต้นด้วย = + - @ กัน Excel เอาไปรันเป็นสูตร
    // (ลูกค้าตั้งชื่อตัวเองเป็นสูตรได้ ถ้าไม่กันไว้จะกลายเป็นช่องโจมตีเครื่องของแอดมิน)
    const safe = (v: unknown) => {
      const s = String(v ?? "");
      return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    };
    const csv = [header, ...body]
      .map((cols) => cols.map((c) => `"${safe(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    // ใส่ BOM เพื่อให้ Excel อ่านภาษาไทยไม่เป็นตัวยึกยือ
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ผู้สนใจ-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">ผู้สนใจ</h1>
        <button className="btn-quiet ml-auto" onClick={downloadCsv} disabled={!data?.items.length}>
          ดาวน์โหลด CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={status === f.value ? "btn-gold" : "btn-quiet"}
          >
            {f.label}
          </button>
        ))}
      </div>

      {msg && <ErrorBox message={msg} />}
      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <Empty label="ยังไม่มีผู้สนใจในหมวดนี้ — เมื่อบอตเก็บข้อมูลได้ จะขึ้นตรงนี้ครับ" />
      )}

      {/* จอเล็กแสดงเป็นการ์ด จอใหญ่ค่อยเป็นตาราง — ตาราง 7 คอลัมน์อ่านบนมือถือไม่ไหว */}
      <div className="space-y-3">
        {data?.items.map((l) => (
          <div key={l.id} className="card space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{l.name || "ไม่ระบุชื่อ"}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[0.85rem]"
                style={{ background: "var(--accent-weak)" }}
              >
                {l.lead_type === "corporate" ? "องค์กร" : "รายบุคคล"}
              </span>
              <span className="soft ml-auto text-[0.85rem]">{thaiTime(l.created_at)}</span>
            </div>

            {l.segment && (
              <p className="text-[0.9rem]">
                <span
                  className="rounded-full px-2 py-0.5"
                  style={{ background: "var(--accent-weak)" }}
                >
                  {SEGMENT_LABEL[l.segment] ?? l.segment}
                </span>
                {l.qualification?.button && (
                  <span className="soft"> · กดปุ่ม “{l.qualification.button}”</span>
                )}
              </p>
            )}

            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <p>
                <span className="soft">ติดต่อ: </span>
                {contactOf(l) || "—"}
              </p>
              <p>
                <span className="soft">สนใจ: </span>
                {l.interest || "—"}
              </p>
              {Object.entries(l.qualification?.fields ?? {})
                .filter(([k]) => k in FIELD_LABEL && k !== "pain" && k !== "use_case")
                .map(([k, v]) => (
                  <p key={k}>
                    <span className="soft">{FIELD_LABEL[k]}: </span>
                    {v}
                  </p>
                ))}
              {l.qualification?.reason && (
                <p>
                  <span className="soft">ส่งต่อเพราะ: </span>
                  {l.qualification.reason}
                </p>
              )}
            </div>
            {l.conversation_id && (
              <a className="text-[0.95rem] underline" href={`/admin/inbox/${l.conversation_id}`}>
                เปิดแชทนี้
              </a>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="soft text-[0.9rem]">สถานะ:</span>
              {(Object.keys(STATUS_LABEL) as Lead["status"][]).map((s) => (
                <button
                  key={s}
                  className={l.status === s ? "btn-gold" : "btn-quiet"}
                  onClick={() => setStatusOf(l, s)}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
