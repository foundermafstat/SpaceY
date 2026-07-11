import type { Metadata, Viewport } from "next";
import { GameAudioUnlock } from "@/components/audio/GameAudioUnlock";
import { TelegramMiniAppRuntime } from "@/components/telegram/TelegramMiniAppRuntime";
import "./globals.css";

export const metadata: Metadata = {
  title: "SpaceY",
  description: "Telegram spacecraft construction and server-authoritative combat game"
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
        <TelegramMiniAppRuntime>
          <GameAudioUnlock />
          {children}
        </TelegramMiniAppRuntime>
      </body>
    </html>
  );
}
