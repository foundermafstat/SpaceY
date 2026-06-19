import type { Metadata } from "next";
import { Play } from "next/font/google";
import "./globals.css";

const play = Play({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "700"],
  variable: "--font-play"
});

export const metadata: Metadata = {
  title: "Starframe Arena MVP",
  description: "Mobile spacecraft builder combat prototype"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={play.variable}>{children}</body>
    </html>
  );
}
