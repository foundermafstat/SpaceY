import type { Metadata, Viewport } from "next";
import { GameAudioUnlock } from "@/components/audio/GameAudioUnlock";
import "./globals.css";

export const metadata: Metadata = {
  title: "Starframe Arena MVP",
  description: "Mobile spacecraft builder combat prototype"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <GameAudioUnlock />
        {children}
      </body>
    </html>
  );
}
