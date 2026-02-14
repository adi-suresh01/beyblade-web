import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beyblade Voice Arena",
  description: "Voice-controlled Beyblade arena with real-time combat and ElevenLabs trash talk"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
