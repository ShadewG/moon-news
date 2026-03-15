"use client";

import { useState } from "react";
import {
  BookOpen,
  Film,
  Sparkles,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Layers,
} from "lucide-react";
import Topbar from "@/components/Topbar";
import ScriptPanel from "@/components/ScriptPanel";
import ResearchPanel from "@/components/ResearchPanel";
import FootagePanel from "@/components/FootagePanel";
import AIVideoPanel from "@/components/AIVideoPanel";
import Timeline from "@/components/Timeline";
import { projectStats } from "@/lib/sample-data";

type Tab = "research" | "footage" | "ai-video";

const tabs: { id: Tab; label: string; icon: typeof BookOpen; color: string }[] = [
  {
    id: "research",
    label: "Deep Research",
    icon: BookOpen,
    color: "var(--accent-blue)",
  },
  {
    id: "footage",
    label: "Source Footage",
    icon: Film,
    color: "var(--accent-purple)",
  },
  {
    id: "ai-video",
    label: "AI Video",
    icon: Sparkles,
    color: "var(--accent-orange)",
  },
];

export default function Home() {
  const [selectedLine, setSelectedLine] = useState("line-1");
  const [activeTab, setActiveTab] = useState<Tab>("research");

  return (
    <div className="h-screen flex flex-col">
      <Topbar />

      {/* Stats Bar */}
      <div className="h-10 border-b border-[var(--border)] flex items-center px-4 gap-6 bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)]">
            {projectStats.totalLines} lines
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={12} className="text-[var(--accent-green)]" />
          <span className="text-xs text-[var(--text-muted)]">
            {projectStats.researched} researched
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Film size={12} className="text-[var(--accent-purple)]" />
          <span className="text-xs text-[var(--text-muted)]">
            {projectStats.footageFound} footage found
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-[var(--accent-orange)]" />
          <span className="text-xs text-[var(--text-muted)]">
            {projectStats.aiGenerated} AI generated
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <Clock size={12} className="text-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)]">
            Duration: {projectStats.totalDuration}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <DollarSign size={12} className="text-[var(--text-muted)]" />
          <span className="text-xs text-[var(--text-muted)]">
            Est. Cost: {projectStats.estimatedCost}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <BarChart3 size={12} className="text-[var(--text-muted)]" />
          <div className="flex items-center gap-1">
            <div className="w-20 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[var(--accent-green)] to-[var(--accent-blue)] rounded-full transition-all"
                style={{
                  width: `${
                    ((projectStats.researched + projectStats.footageFound) /
                      (projectStats.totalLines * 2)) *
                    100
                  }%`,
                }}
              />
            </div>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              {Math.round(
                ((projectStats.researched + projectStats.footageFound) /
                  (projectStats.totalLines * 2)) *
                  100
              )}
              %
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Script Panel (Left) */}
        <ScriptPanel
          selectedLine={selectedLine}
          onSelectLine={setSelectedLine}
        />

        {/* Workspace (Right) */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center border-b border-[var(--border)] bg-[var(--bg-secondary)]">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? "border-[var(--accent-blue)] text-[var(--text-primary)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-light)]"
                  }`}
                >
                  <Icon
                    size={15}
                    style={{ color: isActive ? tab.color : undefined }}
                  />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0">
            {activeTab === "research" && (
              <ResearchPanel selectedLine={selectedLine} />
            )}
            {activeTab === "footage" && (
              <FootagePanel selectedLine={selectedLine} />
            )}
            {activeTab === "ai-video" && (
              <AIVideoPanel selectedLine={selectedLine} />
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <Timeline selectedLine={selectedLine} onSelectLine={setSelectedLine} />
    </div>
  );
}
