import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geist = localFont({
  src: "../public/fonts/geist-latin.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "400 700",
});

const bricolage = localFont({
  src: "../public/fonts/bricolage-grotesque-latin.woff2",
  variable: "--font-bricolage",
  display: "swap",
  weight: "600 700",
});

const jetBrains = localFont({
  src: "../public/fonts/jetbrains-mono-latin.woff2",
  variable: "--font-jetbrains",
  display: "swap",
  weight: "500",
});

export const metadata: Metadata = {
  title: "FISGA — campanhas e conteúdo para Instagram",
  description:
    "Automatize respostas a comentários, publique e agende conteúdo e acompanhe métricas do Instagram em um só lugar.",
  keywords: [
    "automação instagram",
    "comentário para direct",
    "resposta privada instagram",
    "agendamento instagram",
    "métricas instagram",
  ],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "FISGA",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#F6F4EF",
  width: "device-width",
  initialScale: 1,
  // Installed on iOS the app owns the full screen, notch included; the safe
  // area insets below keep content clear of the system UI.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`h-full ${geist.variable} ${bricolage.variable} ${jetBrains.variable}`}
    >
      <body
        className="min-h-full bg-background text-foreground font-sans antialiased"
        // Clears the home indicator when installed; 0 everywhere else.
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
