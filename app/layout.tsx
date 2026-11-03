import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Inter } from "next/font/google";
import "./globals.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Card Forge",
  description: "Turn a photo into a holo trading card: Qwen3-VL writes it and Qwen Image Edit paints you as the hero. Open-weights models on ComfyUI.",
};

export const viewport: Viewport = { themeColor: "#07080d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
