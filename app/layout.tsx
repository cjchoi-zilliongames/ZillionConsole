import type { Metadata } from "next";
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** 관리자(/admin) 영역 — 가독성·UI용 산세리프 */
const adminUiSans = Plus_Jakarta_Sans({
  variable: "--font-admin-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Zillion Console",
  description: "Zillion Console",
  // 파비콘은 app/icon.svg (Next 규칙). metadata.icons + /logo.svg 는
  // link preload 경고를 자주 유발해 제거함. 상단 로고는 여전히 /logo.svg 사용.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${adminUiSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
