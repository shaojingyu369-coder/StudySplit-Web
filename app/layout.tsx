import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "留学AA · StudySplit",
  description: "宿舍共享记账、购物小票认领与转账确认",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
