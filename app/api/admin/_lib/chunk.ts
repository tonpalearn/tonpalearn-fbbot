/**
 * ตัดเอกสารยาวเป็นท่อน ๆ สำหรับฐานความรู้ — ฟังก์ชันบริสุทธิ์ เขียนเทสต์ครอบได้
 *
 * หลักการ: พยายามตัดตรงรอยต่อที่คนอ่านแล้วไม่สะดุด เรียงลำดับความชอบคือ
 *   ย่อหน้า (บรรทัดว่าง) → ขึ้นบรรทัดใหม่ → จบประโยค → ช่องว่าง → ตัดตรง ๆ
 * ภาษาไทยมักไม่มีช่องว่างระหว่างคำ ท่อนสุดท้ายจึงอาจตัดตรงกลางคำได้
 * ซึ่งยอมรับได้เพราะการค้นหาใช้ความคล้ายของตัวอักษร (trigram) ไม่ได้ตัดคำ
 */

export interface ChunkOptions {
  /** ความยาวสูงสุดต่อท่อน (ตัวอักษร) */
  size?: number;
  /** จำนวนตัวอักษรที่ให้ท่อนถัดไปซ้อนทับท่อนก่อนหน้า กันใจความขาดตอน */
  overlap?: number;
}

const DEFAULT_SIZE = 800;
const DEFAULT_OVERLAP = 100;

/** ยอมรับจุดตัดก็ต่อเมื่อเลยครึ่งของท่อนแล้ว ไม่งั้นจะได้ท่อนสั้นกระจุย */
const MIN_RATIO = 0.5;

function lastSentenceEnd(s: string): number {
  const re = /[.!?。ฯ]\s/g;
  let best = -1;
  let m: RegExpExecArray | null = re.exec(s);
  while (m !== null) {
    best = m.index + 1; // ตัดหลังเครื่องหมายจบประโยค
    m = re.exec(s);
  }
  return best;
}

/** หาตำแหน่งตัดที่ดีที่สุดในหน้าต่างนี้ คืน -1 ถ้าไม่เจอที่เหมาะ */
function findBreak(window: string, minAt: number): number {
  const candidates = [
    window.lastIndexOf("\n\n"),
    window.lastIndexOf("\n"),
    lastSentenceEnd(window),
    window.lastIndexOf(" "),
  ];
  for (const c of candidates) {
    if (c >= minAt) return c;
  }
  return -1;
}

export function chunkText(raw: string, options: ChunkOptions = {}): string[] {
  const size = Math.max(50, options.size ?? DEFAULT_SIZE);
  const overlap = Math.max(0, Math.min(options.overlap ?? DEFAULT_OVERLAP, size - 1));

  // ทำให้ขึ้นบรรทัดเป็นแบบเดียวกัน และยุบบรรทัดว่างเกิน 2 บรรทัดลงมา
  const text = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text === "") return [];
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  const minAt = Math.floor(size * MIN_RATIO);
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);

    if (end < text.length) {
      const at = findBreak(text.slice(start, end), minAt);
      if (at > 0) end = start + at;
    }

    const piece = text.slice(start, end).trim();
    if (piece !== "") chunks.push(piece);

    if (end >= text.length) break;
    // บวกอย่างน้อย 1 เสมอ เพื่อรับประกันว่าลูปเดินหน้า ไม่วนไม่รู้จบ
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
