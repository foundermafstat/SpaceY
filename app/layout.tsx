import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
