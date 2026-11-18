import type { Metadata, Viewport } from "next";
import { Anuphan, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

// หัวข้อ = Anuphan · เนื้อความ = IBM Plex Sans Thai (ชุดเดียวกับหน้า booking ของ TONPALEARN)
const anuphan = Anuphan({
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-anuphan",
  display: "swap",
});
const plex = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TONPALEARN — ผู้ช่วยตอบแชทเพจ",
  description: "ระบบตอบแชท Facebook Page อัตโนมัติ พร้อมเก็บผู้สนใจและโอนสายให้คนจริง",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F6F2" },
    { media: "(prefers-color-scheme: dark)", color: "#0C0E13" },
  ],
};

/**
 * ใส่โหมดสี/ขนาดตัวอักษรที่ผู้ใช้เลือกไว้ "ก่อนวาดหน้า" กันจอกะพริบขาว→ดำ
 * ต้องตรงกับ components/display.tsx (คีย์ fbchat_look)
 */
const LOOK_BOOT = `(function(){try{var d=document.documentElement,r=localStorage.getItem('fbchat_look'),l=r?JSON.parse(r):{};
if(!r){var o=localStorage.getItem('fbchat_theme');if(o==='light'||o==='dark')l.theme=o;}
if(l.theme==='light'||l.theme==='dark')d.setAttribute('data-theme',l.theme);
if(l.size==='sm'||l.size==='lg')d.setAttribute('data-size',l.size);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${anuphan.variable} ${plex.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOOK_BOOT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
