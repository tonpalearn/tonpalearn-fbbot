"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { leadFacts, LeadLine, type LeadLike } from "@/components/lead";
import { IconDownload } from "@/components/icons";
import {
  api,
  ContactActions,
  Empty,
  ErrorBox,
  LEAD_STATUS_LABEL,
  LeadStatusBadge,
  Loading,
  PageHeader,
  RefreshButton,
  SEGMENT_LABEL,
  SegmentChip,
  contactText,
  thaiTime,
  useLoad,
} from "@/components/ui";

interface Lead extends LeadLike {
  id: string;
  note: string | null;
  conversation_id: string | null;
  source: string | null;
  lead_type: "individual" | "corporate";
  status: "new" | "contacted" | "won" | "lost";
  created_at: string;
}

const STATUS_TABS = [{ value: "", label: "ทั้งหมด" }, ...Object.entries(LEAD_STATUS_LABEL).map(([value, label]) => ({ value, label }))];

export default function LeadsPage() {
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [segment, setSegment] = useState("");

  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const path = `/api/admin/leads${qs.size ? `?${qs}` : ""}`;
  const { data, error, loading, reload } = useLoad<{ items: Lead[] }>(path);
  const [msg, setMsg] = useState<string | null>(null);

  const all = useMemo(() => data?.items ?? [], [data]);
  const segCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of all) m[l.segment ?? ""] = (m[l.segment ?? ""] ?? 0) + 1;
    return m;
  }, [all]);
  const rows = segment ? all.filter((l) => (l.segment ?? "") === segment) : all;

  async function setStatusOf(lead: Lead, next: Lead["status"]) {
    setMsg(null);
    try {
      await api(`/api/admin/leads/${lead.id}`, { method: "PUT", body: JSON.stringify({ status: next }) });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  function downloadCsv() {
    const header = ["ชื่อ", "เบอร์", "อีเมล", "LINE", "ปุ่มที่กด", "กลุ่ม", "ธุรกิจ", "ปัญหา", "ประเภท", "สถานะ", "วันที่"];
    const body = rows.map((r) => {
      const f = leadFacts(r);
      return [
        r.name ?? "",
        r.phone ?? "",
        r.email ?? "",
        r.line_id ?? "",
        f.button ?? "",
        r.segment ? (SEGMENT_LABEL[r.segment] ?? r.segment) : "",
        f.business ?? "",
        f.pain ?? "",
        r.lead_type === "corporate" ? "องค์กร" : "รายบุคคล",
        LEAD_STATUS_LABEL[r.status] ?? r.status,
        new Date(r.created_at).toLocaleString("th-TH"),
      ];
    });
    // ใส่ ' นำหน้าเซลล์ที่ขึ้นต้นด้วย = + - @ กัน Excel เอาไปรันเป็นสูตร
    // (ลูกค้าตั้งชื่อตัวเองเป็นสูตรได้ ถ้าไม่กันไว้จะกลายเป็นช่องโจมตีเครื่องของแอดมิน)
    const safe = (v: unknown) => {
      const s = String(v ?? "");
      return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    };
    const csv = [header, ...body].map((cols) => cols.map((c) => `"${safe(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    // ใส่ BOM เพื่อให้ Excel อ่านภาษาไทยไม่เป็นตัวยึกยือ
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ผู้สนใจ-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rangeLabel =
    from || to ? `เก็บข้อมูลได้ ${from ? `ตั้งแต่ ${fmtDay(from)}` : ""}${from && to ? " " : ""}${to ? `ถึง ${fmtDay(to)}` : ""}` : "ทุกวันที่";

  return (
    <div>
      <PageHeader
        title="ผู้สนใจ"
        subtitle="คนที่บอตเก็บข้อมูลได้จากแชท · กดชื่อเพื่อเปิดแชท"
        actions={
          <>
            <RefreshButton onClick={reload} busy={loading} />
            <button className="btn-quiet btn-sm" onClick={downloadCsv} disabled={rows.length === 0}>
              <IconDownload size={18} /> CSV
            </button>
          </>
        }
      />

      {/* ตัวกรอง */}
      <div className="card mb-4 space-y-3 p-4">
        <div className="tabs" role="toolbar" aria-label="กรองตามสถานะ">
          {STATUS_TABS.map((f) => (
            <button key={f.value} type="button" className="tab" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <label className="min-w-0 sm:min-w-[11rem]">
            <span className="mb-1 block text-[0.9rem] font-medium">ตั้งแต่วันที่</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="min-w-0 sm:min-w-[11rem]">
            <span className="mb-1 block text-[0.9rem] font-medium">ถึงวันที่</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn-ghost col-span-2 justify-self-start"
            disabled={!from && !to}
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            ล้างวันที่
          </button>
        </div>
        <p className="soft text-[0.88rem]">กรองตาม “วันที่บอตเก็บข้อมูลได้” (เวลาไทย) · ตอนนี้: {rangeLabel}</p>
        {all.length > 0 && (
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="กรองตามกลุ่มจากปุ่มแอด">
            <button type="button" className="tab" aria-pressed={segment === ""} onClick={() => setSegment("")}>
              ทุกกลุ่ม <span className="count">{all.length}</span>
            </button>
            {Object.entries(segCounts)
              .filter(([k]) => k !== "")
              .map(([k, n]) => (
                <button key={k} type="button" className="tab" aria-pressed={segment === k} onClick={() => setSegment(k)}>
                  {SEGMENT_LABEL[k] ?? k} <span className="count">{n}</span>
                </button>
              ))}
          </div>
        )}
      </div>

      {msg && <ErrorBox message={msg} />}
      {loading && !data && <Loading rows={4} />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && rows.length === 0 && (
        <Empty
          label="ไม่มีผู้สนใจตามตัวกรองนี้"
          hint={all.length === 0 && !from && !to && !status ? "เมื่อบอตเก็บข้อมูลได้ จะขึ้นตรงนี้" : "ลองล้างวันที่หรือเลือกสถานะ “ทั้งหมด”"}
        />
      )}

      {rows.length > 0 && (
        <>
          <p className="soft mb-2 text-[0.9rem]">{rows.length.toLocaleString("th-TH")} คน</p>

          {/* จอใหญ่: ตาราง */}
          <div className="card hidden overflow-hidden lg:block">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">ชื่อ · วันที่</th>
                  <th scope="col">ปุ่มที่กด / กลุ่ม</th>
                  <th scope="col">ธุรกิจ · ปัญหา</th>
                  <th scope="col">ติดต่อ</th>
                  <th scope="col">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const f = leadFacts(l);
                  return (
                    <tr key={l.id}>
                      <td className="w-[19%]">
                        <NameLink lead={l} />
                        <p className="soft tnum text-[0.85rem]">{thaiTime(l.created_at)}</p>
                      </td>
                      <td className="w-[16%]">
                        <div className="flex flex-col items-start gap-1">
                          {f.button && <span className="chip chip-gold">“{f.button}”</span>}
                          <SegmentChip segment={l.segment} />
                        </div>
                      </td>
                      <td>
                        {f.business && <p className="font-medium">{f.business}</p>}
                        {f.pain && <p className="text-[0.95rem]">{f.pain}</p>}
                        {!f.business && !f.pain && <span className="soft">—</span>}
                      </td>
                      <td className="w-[19%] text-[0.95rem] break-words">{contactText(l) || <span className="soft">—</span>}</td>
                      <td className="w-[11rem]">
                        <StatusSelect lead={l} onChange={(s) => setStatusOf(l, s)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* จอเล็ก: การ์ด (ตารางหลายคอลัมน์อ่านบนมือถือไม่ไหว) */}
          <ul className="space-y-2.5 lg:hidden">
            {rows.map((l) => (
              <li key={l.id} className={`card space-y-2.5 p-4 ${l.status === "new" ? "card-hot" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <NameLink lead={l} />
                  <LeadStatusBadge status={l.status} />
                  <span className="soft tnum ml-auto text-[0.85rem]">{thaiTime(l.created_at)}</span>
                </div>
                <LeadLine lead={{ ...l, phone: null, email: null, line_id: null }} />
                <ContactActions lead={l} />
                <StatusSelect lead={l} onChange={(s) => setStatusOf(l, s)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function fmtDay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
}

function NameLink({ lead }: { lead: Lead }) {
  const name = lead.name || "ไม่ระบุชื่อ";
  return lead.conversation_id ? (
    <Link href={`/admin/inbox/${lead.conversation_id}`} className="font-semibold underline-offset-4 hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-semibold">{name}</span>
  );
}

function StatusSelect({ lead, onChange }: { lead: Lead; onChange: (s: Lead["status"]) => void }) {
  return (
    <label className="block">
      <span className="sr-only">สถานะของ {lead.name ?? "ผู้สนใจ"}</span>
      <select value={lead.status} onChange={(e) => onChange(e.target.value as Lead["status"])}>
        {Object.entries(LEAD_STATUS_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
