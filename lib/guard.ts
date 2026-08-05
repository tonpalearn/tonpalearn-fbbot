/**
 * ตาข่ายรับคำตอบของโมเดล — บังคับด้วยโค้ด ไม่ใช่แค่ขอร้องในพรอมป์
 *
 * เป้าหมายเดียว: ห้ามให้ตัวเลขราคาหรือวันเวลาที่ "ไม่มีอยู่ในเนื้อหาอ้างอิง" หลุดไปถึงลูกค้า
 * เพราะข้อมูลผิดเรื่องเงินและวันอบรม เสียหายกว่าการตอบว่าไม่รู้แล้วส่งต่อให้คน
 */

/** ตัดตัวคั่นหลักพันและช่องว่างออก เพื่อให้ "5,900" กับ "5900" ถือเป็นตัวเดียวกัน */
function canon(s: string): string {
  return s.replace(/[,\s]/g, "");
}

/**
 * ดึง "ข้อเท็จจริงที่เสี่ยง" ออกจากข้อความ — คือตัวเลขที่ผูกกับเงินหรือวันเวลา
 * คืนเป็นตัวเลขล้วนที่ทำให้เทียบง่าย
 */
export function extractRiskyFacts(text: string): string[] {
  const found: string[] = [];

  // จำนวนเงิน: 5,900 บาท · ฿5900 · 5900.-
  const money = text.matchAll(/(?:฿\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:บาท|฿|บ\.|-\.)/g);
  for (const m of money) found.push(canon(m[1]));
  const bahtPrefix = text.matchAll(/฿\s*(\d[\d,]*(?:\.\d+)?)/g);
  for (const m of bahtPrefix) found.push(canon(m[1]));

  // วันที่: 15 สิงหาคม · 15/8/2569 · 15 ส.ค.
  const thaiMonth =
    "(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.)";
  const dates = text.matchAll(new RegExp(`(\\d{1,2})\\s*${thaiMonth}`, "g"));
  for (const m of dates) found.push(canon(m[0]));
  const slashDates = text.matchAll(/\d{1,2}\/\d{1,2}\/\d{2,4}/g);
  for (const m of slashDates) found.push(canon(m[0]));

  // เวลา: 09:00 น.
  const times = text.matchAll(/\d{1,2}[:.]\d{2}\s*(?:น\.|นาฬิกา)?/g);
  for (const m of times) found.push(canon(m[0]));

  return [...new Set(found)];
}

/**
 * ตรวจว่าคำตอบอ้างตัวเลขที่ไม่มีในเนื้อหาอ้างอิงหรือเปล่า
 * คืนรายการที่ "หาไม่เจอ" — ถ้าไม่ว่าง แปลว่าห้ามส่งคำตอบนี้ออกไป
 */
export function findUnsupportedFacts(answer: string, passages: string[]): string[] {
  const facts = extractRiskyFacts(answer);
  if (facts.length === 0) return [];

  const haystack = canon(passages.join("\n"));
  return facts.filter((f) => !haystack.includes(f));
}
