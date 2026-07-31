import type { Metadata, Viewport } from "next";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/kaushan-script/400.css";
import "./globals.css";
import TopBar from "@/components/TopBar";

export const metadata: Metadata = {
  title: "NorthWood Panthers — Girls Soccer",
  description:
    "Season stats, schedule, player leaders, and program history for NorthWood girls soccer (Varsity & JV).",
  applicationName: "NW Soccer",
  // iOS ignores the web manifest — these are what make "Add to Home Screen"
  // open fullscreen with a black status bar matching the masthead.
  appleWebApp: {
    capable: true,
    title: "NW Soccer",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  // Matches the masthead in each edition so the browser chrome blends in.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0d0d0d" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        <TopBar />
        <main className="shell" id="main">{children}</main>
        <footer className="shell" style={{ paddingTop: 0 }}>
          <div className="footer">
            <span className="motto">Tradition of Excellence</span>
            <span>NorthWood Panthers · Girls Soccer · Northern Lakes Conference</span>
            <span>Data scraped nightly from MaxPreps</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
