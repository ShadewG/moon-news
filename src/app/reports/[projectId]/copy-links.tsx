"use client";

import { useState } from "react";

export default function CopyLinksButton({
  links,
  label,
  small,
}: {
  links: string[];
  label?: string;
  small?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = links.join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (links.length === 0) return null;

  if (small) {
    return (
      <button
        onClick={handleCopy}
        className="text-[10px] px-2 py-0.5 rounded bg-[#1e1e22] text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#27272a] transition-colors"
      >
        {copied ? "Copied!" : label ?? `Copy ${links.length} links`}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1e1e22] text-sm text-[#a1a1aa] hover:text-white hover:bg-[#27272a] transition-colors"
    >
      {copied ? (
        "Copied!"
      ) : (
        <>
          Copy all {links.length} links
        </>
      )}
    </button>
  );
}
