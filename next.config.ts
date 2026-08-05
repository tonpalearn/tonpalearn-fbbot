import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // โฟลเดอร์นี้อยู่ใต้ home ซึ่งมี lockfile อื่นปน — ระบุรากให้ชัดกันหยิบผิดไฟล์
  turbopack: { root: path.resolve(import.meta.dirname) },

  // webhook ของ Facebook ต้องอ่าน raw body เพื่อตรวจลายเซ็น — ห้ามให้ framework แปลง body ก่อน
  // (Route Handler ของ App Router อ่าน raw ได้เองด้วย req.text() จึงไม่ต้องตั้งค่าอะไรเพิ่ม)
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb", // เผื่ออัปโหลดไฟล์ฐานความรู้
    },
  },
};

export default nextConfig;
