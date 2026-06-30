import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";
import { headers } from "next/headers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Agentic OS — Mission Control",
  description: "Your command center for Claude, OpenClaw, Hermes",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Pages that render without the sidebar Shell (login, setup)
const AUTH_PATHS = ["/login", "/setup"];

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? hdrs.get("x-invoke-path") ?? "";
  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p));

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Caveat:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-full">
        <div className="relative z-10">
          {isAuthPage ? children : <Shell>{children}</Shell>}
        </div>
      </body>
    </html>
  );
}
