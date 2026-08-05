/**
 * ฐานความรู้ — อ่านรายการเอกสาร / เพิ่มเอกสารใหม่แล้วตัดเป็นท่อน
 */
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { chunkText } from "../_lib/chunk";
import { pageId } from "../_lib/data";
import { asTrimmed, bad, fail, ok, readJson } from "../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DOC_CHARS = 200_000;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { data, error } = await db()
      .from("kb_documents")
      .select("id,title,source,is_active,created_at,kb_chunks(count)")
      .eq("page_id", pageId())
      .order("created_at", { ascending: false });
    if (error) throw error;

    const items = ((data ?? []) as unknown as {
      id: string;
      title: string;
      source: string | null;
      is_active: boolean;
      created_at: string;
      kb_chunks: { count: number }[] | null;
    }[]).map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
      isActive: d.is_active,
      createdAt: d.created_at,
      chunkCount: d.kb_chunks?.[0]?.count ?? 0,
    }));

    return ok({ items });
  } catch (err) {
    return fail("kb-list", err, "อ่านรายการฐานความรู้ไม่สำเร็จ");
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await readJson(req);
  const title = asTrimmed(body.title);
  const content = asTrimmed(body.content);
  const source = asTrimmed(body.source);

  if (title === "") return bad("กรุณาตั้งชื่อเอกสาร");
  if (content === "") return bad("กรุณาวางเนื้อหา");
  if (content.length > MAX_DOC_CHARS) {
    return bad(`เนื้อหายาวเกินไป (จำกัด ${MAX_DOC_CHARS.toLocaleString("th-TH")} ตัวอักษรต่อเอกสาร)`);
  }

  const chunks = chunkText(content);
  if (chunks.length === 0) return bad("ตัดเนื้อหาเป็นท่อนไม่ได้ ลองตรวจว่าเนื้อหาไม่ว่างเปล่า");

  const page = pageId();

  try {
    const doc = await db()
      .from("kb_documents")
      .insert({ page_id: page, title, source: source === "" ? null : source, raw_content: content })
      .select("id,title,source,is_active,created_at")
      .single();
    if (doc.error) throw doc.error;

    const rows = chunks.map((c, i) => ({
      document_id: doc.data.id as string,
      page_id: page,
      chunk_index: i,
      content: c,
    }));

    const ins = await db().from("kb_chunks").insert(rows);
    if (ins.error) {
      // เอกสารเข้าไปแล้วแต่ท่อนไม่เข้า → เก็บกวาดให้สะอาด ไม่ทิ้งเอกสารที่ค้นไม่เจอ
      await db().from("kb_documents").delete().eq("id", doc.data.id);
      throw ins.error;
    }

    return ok({
      id: doc.data.id,
      title: doc.data.title,
      source: doc.data.source,
      isActive: doc.data.is_active,
      createdAt: doc.data.created_at,
      chunkCount: chunks.length,
    });
  } catch (err) {
    return fail("kb-create", err, "บันทึกเอกสารไม่สำเร็จ");
  }
}
