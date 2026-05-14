import type { Metadata } from "next";
import { Faculty_Glyphic } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const facultyGlyphic = Faculty_Glyphic({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Ascension CoA Builder Data",
  description: "Local Next.js explorer for scraped Ascension CoA builder data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/icon/coa-builder-icon.webp"
          as="image"
          type="image/webp"
          fetchPriority="high"
        />
      </head>
      <body className={facultyGlyphic.variable}>{children}</body>
    </html>
  );
}
