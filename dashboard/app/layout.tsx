import type { Metadata } from "next";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import TopBar from "@/components/TopBar";

export const metadata: Metadata = {
  title: "NorthWood Panthers — Girls Soccer",
  description:
    "Season stats, schedule, player leaders, and program history for NorthWood girls soccer (Varsity & JV).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopBar />
        <main className="shell">{children}</main>
        <footer className="shell" style={{ paddingTop: 0 }}>
          <div className="footer">
            <span>NorthWood Panthers · Girls Soccer · Northern Lakes Conference</span>
            <span>Data scraped nightly from MaxPreps</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
