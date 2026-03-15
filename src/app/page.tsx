"use client";

import { useState } from "react";
import {
  BookOpen,
  Film,
  Music,
  Mic,
  Image,
  Video,
  BarChart3,
  CheckCircle2,
  Clock,
  Layers,
  Sparkles,
} from "lucide-react";
import Topbar from "@/components/Topbar";
import ScriptPanel from "@/components/ScriptPanel";
import ResearchPanel from "@/components/ResearchPanel";
import FootagePanel from "@/components/FootagePanel";
import MusicPanel from "@/components/MusicPanel";
import TranscriptPanel from "@/components/TranscriptPanel";
import AIImagePanel from "@/components/AIImagePanel";
import AIVideoPanel from "@/components/AIVideoPanel";
import Timeline from "@/components/Timeline";
import ExportModal from "@/components/ExportModal";
import { projectStats, formatTimestamp } from "@/lib/sample-data";

type Tab = "research" | "footage" | "music" | "transcripts" | "ai-images" | "ai-video";

const tabs: { id: Tab; label: string; icon: typeof BookOpen; color: string }[] = [
  { id: "research", label: "Research", icon: BookOpen, color: "var(--accent-blue)" },
  { id: "footage", label: "Footage", icon: Film, color: "var(--accent-purple)" },
  { id: "music", label: "Music", icon: Music, color: "var(--accent-green)" },
  { id: "transcripts", label: "Transcripts", icon: Mic, color: "var(--accent-yellow)" },
  { id: "ai-images", label: "AI Images", icon: Image, color: "var(--accent-orange)" },
  { id: "ai-video", label: "AI Video", icon: Video, color: "var(--accent-red)" },
];

export default function Home() {
  const [selectedLine, setSelectedLine] = useState("line-1");
  const [activeTab, setActiveTab] = useState<Tab>("research");
  const [exportOpen, setExportOpen] = useState(false);

  const totalDomains = projectStats.totalLines * 4; // research, footage, image, video per line
  const completeDomains =
    projectStats.researchComplete +
    projectStats.footageComplete +
    projectStats.imagesGenerated +
    projectStats.videosGenerated;
  const progressPct = Math.round((completeDomains / totalDomains) * 100);

  return (
    <div className="h-screen flex flex-col">
      <Topbar onExportClick={() => setExportOpen(true)} />

      {/* Stats Bar */}
      <div className="h-10 border-b border-[var(--border)] flex items-center px-4 gap-5 bg-[var(--bg-secondary)]">
        <StatItem icon={Layers} color="" label={`${projectStats.totalLines} lines`} />
        <StatItem icon={BookOpen} color="text-[var(--accent-blue)]" label={`${projectStats.researchComplete} researched`} />
        {projectStats.researchRunning > 0 && (
          <StatItem icon={Clock} color="text-[var(--accent-orange)]" label={`${projectStats.researchRunning} running`} />
        )}
        <StatItem icon={Film} color="text-[var(--accent-purple)]" label={`${projectStats.footageComplete} footage`} />
        <StatItem icon={Image} color="text-[var(--accent-orange)]" label={`${projectStats.imagesGenerated} images`} />
        <StatItem icon={Video} color="text-[var(--accent-red)]" label={`${projectStats.videosGenerated} videos`} />
        <StatItem icon={Mic} color="text-[var(--accent-yellow)]" label={`${projectStats.transcriptsComplete} transcripts`} />
        <StatItem icon={Music} color="text-[var(--accent-green)]" label={`${projectStats.musicSelected} music`} />

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          <Clock size={11} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">
            {formatTimestamp(projectStats.totalDurationMs)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">
            {projectStats.estimatedCost}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <BarChart3 size={11} className="text-[var(--text-muted)]" />
          <div className="w-16 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--accent-green)] to-[var(--accent-blue)] rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] text-[var(--text-muted)] font-mono">{progressPct}%</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        <ScriptPanel selectedLine={selectedLine} onSelectLine={setSelectedLine} />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center border-b border-[var(--border)] bg-[var(--bg-secondary)] overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? "border-[var(--accent-blue)] text-[var(--text-primary)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-light)]"
                  }`}
                >
                  <Icon size={13} style={{ color: isActive ? tab.color : undefined }} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0">
            {activeTab === "research" && <ResearchPanel selectedLine={selectedLine} />}
            {activeTab === "footage" && <FootagePanel selectedLine={selectedLine} />}
            {activeTab === "music" && <MusicPanel selectedLine={selectedLine} />}
            {activeTab === "transcripts" && <TranscriptPanel selectedLine={selectedLine} />}
            {activeTab === "ai-images" && <AIImagePanel selectedLine={selectedLine} />}
            {activeTab === "ai-video" && <AIVideoPanel selectedLine={selectedLine} />}
          </div>
        </div>
      </div>

      <Timeline selectedLine={selectedLine} onSelectLine={setSelectedLine} />
      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

function StatItem({ icon: Icon, color, label }: { icon: typeof BookOpen; color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <Icon size={11} className={color || "text-[var(--text-muted)]"} />
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
    </div>
  );
}
