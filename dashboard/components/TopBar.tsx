"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/schedule", label: "Schedule" },
  { href: "/players", label: "Players" },
  { href: "/history", label: "History" },
];

function TopBarInner() {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString() ? `?${params.toString()}` : "";

  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link href={`/${qs}`} className="wordmark">
          <span className="nw">
            North<em>Wood</em> Panthers
          </span>
          <span className="tag">Girls Soccer · Nappanee, Ind.</span>
        </Link>
        <nav className="mast-nav" aria-label="Primary">
          {TABS.map((t) => {
            const active =
              t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
            return (
              <Link key={t.href} href={`${t.href}${qs}`} data-active={active}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export default function TopBar() {
  return (
    <Suspense fallback={<header className="masthead"><div className="masthead-inner"><span className="wordmark"><span className="nw">North<em>Wood</em> Panthers</span></span></div></header>}>
      <TopBarInner />
    </Suspense>
  );
}
