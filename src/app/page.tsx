"use client";

import { useState, useEffect } from "react";
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
  Wifi,
  WifiOff,
} from "lucide-react";
import { ProjectProvider, useProjectContext } from "@/lib/project-context";
import { useProjects } from "@/lib/hooks";
import * as api from "@/lib/api";
import { formatTimestamp, sampleProject, sampleScript } from "@/lib/sample-data";
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
  const [projectId, setProjectId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const { data: projects, loading: loadingProjects, refetch: refetchProjects } = useProjects();

  // Auto-select first project or seed one
  useEffect(() => {
    if (loadingProjects) return;
    if (projects.length > 0) {
      setProjectId(projects[0].id);
    } else if (!seeding) {
      // No projects in DB — try to seed from sample script
      setSeeding(true);
      api
        .createProject({
          title: sampleProject.title,
          rawScript: sampleScript.map((l) => l.text).join("\n"),
          lines: sampleScript.map((l) => ({
            lineKey: l.line_key,
            lineIndex: l.line_index,
            text: l.text,
            lineType: l.line_type,
            timestampStartMs: l.timestamp_start_ms,
            durationMs: l.duration_ms,
          })),
        })
        .then((res) => {
          setProjectId(res.project.id);
          refetchProjects();
        })
        .catch(() => {
          // DB not available — projectId stays null, will use sample data via fallback
          setSeeding(false);
        });
    }
  }, [projects, loadingProjects, seeding, refetchProjects]);

  return (
    <ProjectProvider projectId={projectId}>
      <AppShell />
    </ProjectProvider>
  );
}

function AppShell() {
  const { stats, isLive, selectedLineId, setSelectedLineId } = useProjectContext();
  const [activeTab, setActiveTab] = useState<Tab>("research");
  const [exportOpen, setExportOpen] = useState(false);

  const totalDomains = stats.totalLines * 4;
  const completeDomains =
    stats.researchComplete + stats.footageComplete + stats.imagesGenerated + stats.videosGenerated;
  const progressPct = totalDomains > 0 ? Math.round((completeDomains / totalDomains) * 100) : 0;

  return (
    <div className="h-screen flex flex-col">
      <Topbar onExportClick={() => setExportOpen(true)} />

      {/* Stats Bar */}
      <div className="h-10 border-b border-[var(--border)] flex items-center px-4 gap-5 bg-[var(--bg-secondary)]">
        {/* Live/Offline indicator */}
        <div className="flex items-center gap-1" title={isLive ? "Connected to backend" : "Using sample data"}>
          {isLive ? (
            <Wifi size={11} className="text-[var(--accent-green)]" />
          ) : (
            <WifiOff size={11} className="text-[var(--accent-orange)]" />
          )}
          <span className="text-[10px] text-[var(--text-muted)]">
            {isLive ? "Live" : "Demo"}
          </span>
        </div>

        <div className="h-4 w-px bg-[var(--border)]" />

        <StatItem icon={Layers} color="" label={`${stats.totalLines} lines`} />
        <StatItem icon={BookOpen} color="text-[var(--accent-blue)]" label={`${stats.researchComplete} researched`} />
        {stats.researchRunning > 0 && (
          <StatItem icon={Clock} color="text-[var(--accent-orange)]" label={`${stats.researchRunning} running`} />
        )}
        <StatItem icon={Film} color="text-[var(--accent-purple)]" label={`${stats.footageComplete} footage`} />
        <StatItem icon={Image} color="text-[var(--accent-orange)]" label={`${stats.imagesGenerated} images`} />
        <StatItem icon={Video} color="text-[var(--accent-red)]" label={`${stats.videosGenerated} videos`} />
        <StatItem icon={Mic} color="text-[var(--accent-yellow)]" label={`${stats.transcriptsComplete} transcripts`} />
        <StatItem icon={Music} color="text-[var(--accent-green)]" label={`${stats.musicSelected} music`} />

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          <Clock size={11} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">
            {formatTimestamp(stats.totalDurationMs)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">{stats.estimatedCost}</span>
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
        <ScriptPanel />

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

          <div className="flex-1 min-h-0">
            {activeTab === "research" && <ResearchPanel />}
            {activeTab === "footage" && <FootagePanel />}
            {activeTab === "music" && <MusicPanel />}
            {activeTab === "transcripts" && <TranscriptPanel />}
            {activeTab === "ai-images" && <AIImagePanel />}
            {activeTab === "ai-video" && <AIVideoPanel />}
          </div>
        </div>
      </div>

      <Timeline />
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
