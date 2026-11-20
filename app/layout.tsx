import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "マツバラ 月次業績・経営分析",
  description: "月次の予算実績管理と差異分析",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
