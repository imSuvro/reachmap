import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";

// display "optional": text paints once and never re-paints on font arrival —
// a font-swap repaint re-records the LCP entry seconds later on slow devices
// (measured: 4.7s -> the fonts are a progressive enhancement, cached visits get them)
const ui = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "optional",
});
const display = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "optional",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-mono",
  display: "optional",
});

export const metadata: Metadata = {
  title: "ReachMap — how far can Chennai take you?",
  description:
    "Click anywhere in Chennai and see everywhere the bus and metro can take you in 15, 30, 45 and 60 minutes — computed from the real public timetable, entirely in your browser.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
