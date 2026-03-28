"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/ideation", label: "Dashboard", icon: "◇", exact: true },
  { href: "/ideation/ideas", label: "Ideas", icon: "◆" },
];

const STUDIO_LINKS: { href: string; label: string; icon: string; ext?: boolean }[] = [
  { href: "/script-lab", label: "Generate", icon: "✦", ext: true },
  { href: "/ideation/research", label: "Research", icon: "◈" },
  { href: "/library", label: "Library", icon: "▶", ext: true },
  { href: "/moon-analysis", label: "Analysis", icon: "◌", ext: true },
];

const SYSTEM_ITEMS = [
  { href: "/ideation/watchlist", label: "Watchlist", icon: "⊟" },
  { href: "/ideation/settings", label: "Settings", icon: "⚙" },
];

export default function IdeationSidebar() {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <nav className="ibs">
      <div className="ibs-brand">
        <span className="ibs-title">Ideation</span>
        <span className="ibs-ver">v2</span>
      </div>

      <div className="ibs-section">Pipeline</div>
      {NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href}
          className={`ibs-item${isActive(item.href, item.exact) ? " ibs-active" : ""}`}>
          <span className="ibs-icon">{item.icon}</span>
          {item.label}
        </Link>
      ))}

      <div className="ibs-divider" />
      <div className="ibs-section">Studio</div>
      {STUDIO_LINKS.map((item) => (
        <Link key={item.href} href={item.href}
          className={`ibs-item${item.ext ? " ibs-ext" : ""}${!item.ext && isActive(item.href) ? " ibs-active" : ""}`}>
          <span className="ibs-icon">{item.icon}</span>
          {item.label}
        </Link>
      ))}

      <div className="ibs-divider" />
      <div className="ibs-section">System</div>
      {SYSTEM_ITEMS.map((item) => (
        <Link key={item.href} href={item.href}
          className={`ibs-item${isActive(item.href) ? " ibs-active" : ""}`}>
          <span className="ibs-icon">{item.icon}</span>
          {item.label}
        </Link>
      ))}

      <div className="ibs-footer">
        <span className="ibs-dot" />
        READY
      </div>

      <style jsx>{`
        .ibs {
          width: 200px;
          min-width: 200px;
          background: #0a0a0a;
          border-right: 1px solid #181818;
          display: flex;
          flex-direction: column;
          font-family: 'IBM Plex Mono', var(--font-geist-mono), ui-monospace, monospace;
          font-size: 11px;
          overflow-y: auto;
          color: #666;
        }
        .ibs-brand {
          padding: 18px 16px 14px;
          border-bottom: 1px solid #181818;
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .ibs-title {
          font-size: 16px;
          font-weight: 700;
          color: #ccc;
          letter-spacing: -0.5px;
        }
        .ibs-ver {
          font-size: 9px;
          color: #444;
          letter-spacing: 0.5px;
        }
        .ibs-section {
          padding: 14px 16px 6px;
          font-size: 9px;
          font-weight: 600;
          color: #444;
          text-transform: uppercase;
          letter-spacing: 1.5px;
        }
        .ibs-divider {
          height: 1px;
          background: #181818;
          margin: 6px 16px;
        }
        .ibs-item {
          padding: 8px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          color: #666;
          text-decoration: none;
          transition: all 0.15s;
          border-left: 2px solid transparent;
          font-size: 12px;
          font-weight: 500;
        }
        .ibs-item:hover {
          background: #0c0c0c;
          color: #ccc;
        }
        .ibs-active {
          background: #0c0c0c;
          color: #5b9;
          border-left-color: #5b9;
        }
        .ibs-ext {
          color: #3a6e5a;
        }
        .ibs-ext:hover {
          color: #5b9 !important;
          background: #0a1a12 !important;
        }
        .ibs-icon {
          font-size: 12px;
          width: 16px;
          text-align: center;
          flex-shrink: 0;
        }
        .ibs-footer {
          margin-top: auto;
          padding: 14px 16px;
          border-top: 1px solid #181818;
          font-size: 9px;
          font-weight: 600;
          color: #444;
          letter-spacing: 1.5px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ibs-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #5b9;
          box-shadow: 0 0 6px #5b9;
        }
      `}</style>
    </nav>
  );
}
