"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/board", label: "Board", icon: "◈" },
  { href: "/library", label: "Library", icon: "▶" },
  { href: "/", label: "Studio", icon: "⊞" },
  { href: "/script-lab", label: "Generate", icon: "✦" },
  { href: "/moon-analysis", label: "Analysis", icon: "◌" },
  { href: "/intake", label: "Intake", icon: "⟐" },
];

const IDEATION_ITEMS = [
  { href: "/ideation", label: "Ideation" },
];

export default function GlobalNav() {
  const pathname = usePathname();

  const activeSection = pathname.startsWith("/board")
    ? "/board"
    : pathname.startsWith("/library") || pathname.startsWith("/clips")
      ? "/library"
      : pathname.startsWith("/search")
        ? "/library"
        : pathname.startsWith("/script-lab")
          ? "/script-lab"
          : pathname.startsWith("/moon-analysis")
            ? "/moon-analysis"
            : pathname.startsWith("/intake")
              ? "/intake"
              : pathname.startsWith("/ideation")
                ? "/ideation"
                : pathname.startsWith("/script-agent") || pathname.startsWith("/reports")
                  ? "/"
                  : pathname;

  return (
    <nav className="global-nav">
      <Link href="/" className="global-nav-logo">
        Moon
      </Link>
      <div className="global-nav-sep" />
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`global-nav-item${activeSection === item.href ? " active" : ""}`}
        >
          <span className="global-nav-icon">{item.icon}</span>
          <span className="global-nav-label">{item.label}</span>
        </Link>
      ))}
      <div className="global-nav-spacer" />
      <div className="global-nav-sep" />
      {IDEATION_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`global-nav-ext${activeSection === "/ideation" ? " global-nav-ext-active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
      <Link href="/library" className="global-nav-search">
        search
      </Link>

      <style>{`
        .global-nav {
          height: 32px;
          background: #050505;
          border-bottom: 1px solid #151515;
          display: flex;
          align-items: center;
          padding: 0 12px;
          gap: 2px;
          font-family: 'IBM Plex Mono', ui-monospace, monospace;
          font-size: 11px;
          flex-shrink: 0;
          z-index: 50;
        }
        .global-nav-logo {
          color: #5b9;
          font-weight: 700;
          font-size: 12px;
          text-decoration: none;
          padding: 0 8px;
          letter-spacing: -0.5px;
        }
        .global-nav-sep {
          width: 1px;
          height: 14px;
          background: #1a1a1a;
          margin: 0 6px;
        }
        .global-nav-item {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          color: #555;
          text-decoration: none;
          border-radius: 3px;
          transition: all 0.12s;
        }
        .global-nav-item:hover { color: #999; background: #111; }
        .global-nav-item.active { color: #ccc; background: #151515; }
        .global-nav-icon { font-size: 10px; }
        .global-nav-label { font-size: 11px; }
        .global-nav-spacer { flex: 1; }
        .global-nav-ext {
          padding: 3px 9px;
          color: #3a6e5a;
          text-decoration: none;
          border-radius: 3px;
          font-size: 10px;
          transition: all 0.12s;
          border: 1px solid transparent;
        }
        .global-nav-ext:hover {
          color: #5b9;
          border-color: #1a3a2a;
          background: #0a1a12;
        }
        .global-nav-ext-active {
          color: #5b9 !important;
          border-color: #1a3a2a;
          background: #0a1a12;
        }
        .global-nav-search {
          color: #333;
          text-decoration: none;
          padding: 3px 10px;
          border: 1px solid #1a1a1a;
          border-radius: 3px;
          font-size: 10px;
          transition: all 0.12s;
          margin-left: 6px;
        }
        .global-nav-search:hover { color: #666; border-color: #333; }
      `}</style>
    </nav>
  );
}
