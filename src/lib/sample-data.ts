export interface ScriptLine {
  id: string;
  timestamp: string;
  duration: string;
  text: string;
  type: "narration" | "quote" | "transition" | "headline";
  status: "researched" | "in-progress" | "pending" | "footage-found";
}

export interface ResearchResult {
  id: string;
  lineId: string;
  title: string;
  source: string;
  sourceUrl: string;
  snippet: string;
  relevanceScore: number;
  type: "article" | "document" | "book" | "video" | "academic";
  date: string;
}

export interface FootageResult {
  id: string;
  lineId: string;
  title: string;
  source: string;
  thumbnailUrl: string;
  duration: string;
  resolution: string;
  type: "stock" | "news" | "documentary" | "archive" | "b-roll";
  matchScore: number;
  previewUrl: string;
  license: string;
  price: string;
}

export interface AIVideoOption {
  id: string;
  lineId: string;
  style: string;
  description: string;
  estimatedTime: string;
  status: "ready" | "generating" | "complete" | "queued";
  progress: number;
  thumbnailUrl: string;
  model: string;
}

export const sampleScript: ScriptLine[] = [
  {
    id: "line-1",
    timestamp: "00:00",
    duration: "8s",
    text: "The CIA has been on every podcast you listen to. And no, that's not a conspiracy theory — it's a documented media strategy decades in the making.",
    type: "headline",
    status: "researched",
  },
  {
    id: "line-2",
    timestamp: "00:08",
    duration: "12s",
    text: "In the 1950s, the agency launched Operation Mockingbird — a covert campaign to influence domestic and foreign media by recruiting journalists, editors, and media executives.",
    type: "narration",
    status: "researched",
  },
  {
    id: "line-3",
    timestamp: "00:20",
    duration: "10s",
    text: "Fast forward to 2002: the Pentagon deployed 'message force multipliers' — retired military analysts planted across TV networks to shape public opinion on the Iraq War.",
    type: "narration",
    status: "footage-found",
  },
  {
    id: "line-4",
    timestamp: "00:30",
    duration: "9s",
    text: "Today, podcasting has become the CIA's latest frontier. Former operatives are everywhere — Joe Rogan, Lex Fridman, Shawn Ryan Show, and dozens more.",
    type: "narration",
    status: "in-progress",
  },
  {
    id: "line-5",
    timestamp: "00:39",
    duration: "11s",
    text: "\"Every podcast quote from a former CIA officer was read and approved by the CIA before you ever heard it.\" — CIA Prepublication Review Board requirement",
    type: "quote",
    status: "researched",
  },
  {
    id: "line-6",
    timestamp: "00:50",
    duration: "10s",
    text: "John Kiriakou was imprisoned for exposing the CIA's torture programs. Now he appears across major podcasts with what critics call 'remarkable consistency' in his messaging.",
    type: "narration",
    status: "footage-found",
  },
  {
    id: "line-7",
    timestamp: "01:00",
    duration: "9s",
    text: "Andrew Bustamante, former covert officer, repackages CIA recruitment tactics as self-help content through his 'EverydaySpy' platform — monetizing espionage for the masses.",
    type: "narration",
    status: "pending",
  },
  {
    id: "line-8",
    timestamp: "01:09",
    duration: "11s",
    text: "Mike Baker has appeared on Joe Rogan over 21 times. He openly admits to CIA interference in foreign elections while casually framing it as 'obvious' and unremarkable.",
    type: "narration",
    status: "in-progress",
  },
  {
    id: "line-9",
    timestamp: "01:20",
    duration: "8s",
    text: "Intelligence analysts call this a 'limited hangout' — admit something controversial, but present it so casually that it loses its power to shock.",
    type: "narration",
    status: "pending",
  },
  {
    id: "line-10",
    timestamp: "01:28",
    duration: "10s",
    text: "The best way to hide a secret is to surround it with so much noise that no one can pick it out. That's not paranoia — that's information warfare.",
    type: "headline",
    status: "pending",
  },
  {
    id: "line-11",
    timestamp: "01:38",
    duration: "7s",
    text: "[TRANSITION: Cut to montage of podcast clips featuring former intelligence officers]",
    type: "transition",
    status: "pending",
  },
  {
    id: "line-12",
    timestamp: "01:45",
    duration: "12s",
    text: "So the next time a former CIA officer shows up on your favorite podcast sounding reasonable, relatable, and refreshingly honest — ask yourself: who approved this message?",
    type: "headline",
    status: "pending",
  },
];

export const sampleResearch: Record<string, ResearchResult[]> = {
  "line-1": [
    {
      id: "r1-1",
      lineId: "line-1",
      title: "CIA's Evolving Media Strategy: From Print to Podcasts",
      source: "The Intercept",
      sourceUrl: "https://theintercept.com/cia-media-strategy",
      snippet: "Declassified documents reveal the CIA has systematically adapted its media influence operations for each new communication platform, from newspapers to radio, television, and now digital media including podcasts...",
      relevanceScore: 97,
      type: "article",
      date: "2024-03-15",
    },
    {
      id: "r1-2",
      lineId: "line-1",
      title: "Manufacturing Consent in the Digital Age",
      source: "Columbia Journalism Review",
      sourceUrl: "https://cjr.org/digital-age-consent",
      snippet: "Media scholars have noted an unprecedented surge in former intelligence community members appearing across independent media platforms, raising questions about the boundary between transparency and strategic communication...",
      relevanceScore: 89,
      type: "academic",
      date: "2024-01-22",
    },
    {
      id: "r1-3",
      lineId: "line-1",
      title: "The Intelligence Community's Public Relations Playbook",
      source: "Foreign Policy",
      sourceUrl: "https://foreignpolicy.com/ic-pr-playbook",
      snippet: "Former directors have acknowledged that the intelligence community actively manages its public image through strategic media engagement, including podcast appearances...",
      relevanceScore: 85,
      type: "article",
      date: "2023-11-08",
    },
  ],
  "line-2": [
    {
      id: "r2-1",
      lineId: "line-2",
      title: "Operation Mockingbird: CIA Media Manipulation (Declassified)",
      source: "National Security Archive",
      sourceUrl: "https://nsarchive.gwu.edu/mockingbird",
      snippet: "Church Committee hearings in 1975 revealed the CIA maintained relationships with over 50 U.S. journalists and media figures, including editors at major publications...",
      relevanceScore: 98,
      type: "document",
      date: "1975-04-26",
    },
    {
      id: "r2-2",
      lineId: "line-2",
      title: "The CIA and the Media: Carl Bernstein's Investigation",
      source: "Rolling Stone",
      sourceUrl: "https://rollingstone.com/bernstein-cia-media",
      snippet: "Bernstein's landmark 1977 investigation revealed that more than 400 American journalists had carried out assignments for the Central Intelligence Agency over the previous 25 years...",
      relevanceScore: 95,
      type: "article",
      date: "1977-10-20",
    },
    {
      id: "r2-3",
      lineId: "line-2",
      title: "Legacy of Ashes: The History of the CIA",
      source: "Tim Weiner — Doubleday",
      sourceUrl: "https://books.example.com/legacy-of-ashes",
      snippet: "Weiner's Pulitzer Prize-winning history documents how the CIA recruited assets within every major American news organization during the Cold War era...",
      relevanceScore: 91,
      type: "book",
      date: "2007-06-22",
    },
  ],
  "line-3": [
    {
      id: "r3-1",
      lineId: "line-3",
      title: "Pentagon's 'Message Force Multiplier' Program Exposed",
      source: "New York Times",
      sourceUrl: "https://nytimes.com/pentagon-analysts",
      snippet: "A 2008 NYT investigation by David Barstow revealed the Pentagon recruited over 75 retired military analysts to serve as TV commentators, secretly coordinating their talking points...",
      relevanceScore: 99,
      type: "article",
      date: "2008-04-20",
    },
    {
      id: "r3-2",
      lineId: "line-3",
      title: "DoD Inspector General Report on Media Analyst Program",
      source: "Department of Defense",
      sourceUrl: "https://dodig.mil/reports/media-analysts",
      snippet: "The IG report found that the Pentagon provided retired military analysts with classified intelligence briefings and coordinated talking points before their television appearances...",
      relevanceScore: 94,
      type: "document",
      date: "2009-01-14",
    },
  ],
  "line-5": [
    {
      id: "r5-1",
      lineId: "line-5",
      title: "CIA Prepublication Review Board: Rules and Controversies",
      source: "Lawfare Blog",
      sourceUrl: "https://lawfaremedia.org/cia-prepub-review",
      snippet: "All current and former CIA employees must submit any public statements — including podcast appearances — to the CIA's Publications Review Board before dissemination. Failure to comply can result in legal action...",
      relevanceScore: 96,
      type: "article",
      date: "2023-09-14",
    },
    {
      id: "r5-2",
      lineId: "line-5",
      title: "Snepp v. United States (1980) — Prepublication Review Precedent",
      source: "Supreme Court Records",
      sourceUrl: "https://supremecourt.gov/snepp-v-us",
      snippet: "The Supreme Court upheld the CIA's prepublication review requirement, establishing that former employees have a contractual obligation to submit all writings for review...",
      relevanceScore: 92,
      type: "document",
      date: "1980-02-19",
    },
  ],
  "line-6": [
    {
      id: "r6-1",
      lineId: "line-6",
      title: "John Kiriakou: The CIA Whistleblower Who Went to Prison",
      source: "The Guardian",
      sourceUrl: "https://theguardian.com/kiriakou-whistleblower",
      snippet: "Kiriakou became the first CIA officer to publicly confirm the agency's use of waterboarding. He was subsequently charged under the Espionage Act and served 30 months in federal prison...",
      relevanceScore: 97,
      type: "article",
      date: "2015-02-09",
    },
    {
      id: "r6-2",
      lineId: "line-6",
      title: "Doing Time Like a Spy: How the CIA Taught Me to Survive Prison",
      source: "John Kiriakou — Rare Bird Books",
      sourceUrl: "https://books.example.com/doing-time-spy",
      snippet: "Kiriakou's memoir details his transition from CIA counterterrorism officer to federal prisoner, and his subsequent media career as a commentator on intelligence community affairs...",
      relevanceScore: 88,
      type: "book",
      date: "2017-04-11",
    },
  ],
};

export const sampleFootage: Record<string, FootageResult[]> = {
  "line-1": [
    {
      id: "f1-1",
      lineId: "line-1",
      title: "Podcast Studio Setup — Professional Recording",
      source: "Shutterstock",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "0:15",
      resolution: "4K",
      type: "stock",
      matchScore: 94,
      previewUrl: "#",
      license: "Standard",
      price: "$79",
    },
    {
      id: "f1-2",
      lineId: "line-1",
      title: "CIA Headquarters — Aerial Drone Shot",
      source: "Getty Images",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "0:12",
      resolution: "4K",
      type: "stock",
      matchScore: 91,
      previewUrl: "#",
      license: "Editorial",
      price: "$199",
    },
    {
      id: "f1-3",
      lineId: "line-1",
      title: "Langley Virginia Campus — News Archive",
      source: "AP Archive",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "0:22",
      resolution: "1080p",
      type: "archive",
      matchScore: 87,
      previewUrl: "#",
      license: "Editorial",
      price: "$149",
    },
  ],
  "line-2": [
    {
      id: "f2-1",
      lineId: "line-2",
      title: "1950s Newsroom — Black & White Archive",
      source: "Prelinger Archives",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "0:30",
      resolution: "1080p (upscaled)",
      type: "archive",
      matchScore: 96,
      previewUrl: "#",
      license: "Public Domain",
      price: "Free",
    },
    {
      id: "f2-2",
      lineId: "line-2",
      title: "Vintage Newspaper Printing Press",
      source: "Pond5",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "0:18",
      resolution: "4K",
      type: "stock",
      matchScore: 89,
      previewUrl: "#",
      license: "Standard",
      price: "$49",
    },
    {
      id: "f2-3",
      lineId: "line-2",
      title: "Cold War Era CIA Recruitment Film",
      source: "National Archives",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "1:45",
      resolution: "720p (restored)",
      type: "documentary",
      matchScore: 93,
      previewUrl: "#",
      license: "Public Domain",
      price: "Free",
    },
  ],
  "line-3": [
    {
      id: "f3-1",
      lineId: "line-3",
      title: "Pentagon Building — Establishing Shot",
      source: "Shutterstock",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "0:10",
      resolution: "4K",
      type: "stock",
      matchScore: 95,
      previewUrl: "#",
      license: "Standard",
      price: "$79",
    },
    {
      id: "f3-2",
      lineId: "line-3",
      title: "Iraq War 2003 — TV News Compilation",
      source: "CNN Archive",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "2:30",
      resolution: "1080p",
      type: "news",
      matchScore: 97,
      previewUrl: "#",
      license: "Editorial",
      price: "$299",
    },
    {
      id: "f3-3",
      lineId: "line-3",
      title: "Military Analyst on Cable News — 2003",
      source: "C-SPAN Archive",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "3:15",
      resolution: "720p",
      type: "news",
      matchScore: 92,
      previewUrl: "#",
      license: "Public Domain",
      price: "Free",
    },
  ],
  "line-6": [
    {
      id: "f6-1",
      lineId: "line-6",
      title: "John Kiriakou — Senate Hearing Testimony",
      source: "C-SPAN",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "5:20",
      resolution: "1080p",
      type: "news",
      matchScore: 99,
      previewUrl: "#",
      license: "Public Domain",
      price: "Free",
    },
    {
      id: "f6-2",
      lineId: "line-6",
      title: "Whistleblower Documentary — 'Silenced' Clip",
      source: "Documentary Archive",
      thumbnailUrl: "/api/placeholder/320/180",
      duration: "1:45",
      resolution: "1080p",
      type: "documentary",
      matchScore: 94,
      previewUrl: "#",
      license: "Fair Use",
      price: "$0 (clip)",
    },
  ],
};

export const sampleAIOptions: Record<string, AIVideoOption[]> = {
  "line-1": [
    {
      id: "ai-1-1",
      lineId: "line-1",
      style: "Cinematic Documentary",
      description: "Dark, moody establishing shot of a podcast studio that slowly reveals CIA imagery blending into the microphone reflections",
      estimatedTime: "~45s",
      status: "complete",
      progress: 100,
      thumbnailUrl: "/api/placeholder/320/180",
      model: "Sora v2",
    },
    {
      id: "ai-1-2",
      lineId: "line-1",
      style: "Motion Graphics",
      description: "Animated infographic showing podcast icons connected by network lines to a central CIA seal, data-visualization style",
      estimatedTime: "~30s",
      status: "ready",
      progress: 0,
      thumbnailUrl: "/api/placeholder/320/180",
      model: "Runway Gen-3",
    },
    {
      id: "ai-1-3",
      lineId: "line-1",
      style: "Realistic B-Roll",
      description: "Photorealistic CIA headquarters exterior transitioning into a modern podcast studio interior",
      estimatedTime: "~60s",
      status: "generating",
      progress: 67,
      thumbnailUrl: "/api/placeholder/320/180",
      model: "Kling v2",
    },
  ],
  "line-2": [
    {
      id: "ai-2-1",
      lineId: "line-2",
      style: "Historical Recreation",
      description: "1950s-style black and white footage of journalists in a newsroom, with subtle CIA documents visible on desks",
      estimatedTime: "~50s",
      status: "ready",
      progress: 0,
      thumbnailUrl: "/api/placeholder/320/180",
      model: "Sora v2",
    },
    {
      id: "ai-2-2",
      lineId: "line-2",
      style: "Animated Explainer",
      description: "Paper-craft style animation showing newspaper headlines being 'controlled' by invisible puppet strings",
      estimatedTime: "~35s",
      status: "queued",
      progress: 0,
      thumbnailUrl: "/api/placeholder/320/180",
      model: "Runway Gen-3",
    },
  ],
  "line-3": [
    {
      id: "ai-3-1",
      lineId: "line-3",
      style: "News Recreation",
      description: "Stylized recreation of a Pentagon briefing room with retired generals reviewing talking points before going on camera",
      estimatedTime: "~55s",
      status: "generating",
      progress: 34,
      thumbnailUrl: "/api/placeholder/320/180",
      model: "Sora v2",
    },
  ],
  "line-10": [
    {
      id: "ai-10-1",
      lineId: "line-10",
      style: "Abstract Visual",
      description: "Visual metaphor of signal vs. noise — a clear truth slowly being buried under layers of information static",
      estimatedTime: "~40s",
      status: "ready",
      progress: 0,
      thumbnailUrl: "/api/placeholder/320/180",
      model: "Kling v2",
    },
  ],
};

export interface ProjectStats {
  totalLines: number;
  researched: number;
  footageFound: number;
  aiGenerated: number;
  totalDuration: string;
  estimatedCost: string;
}

export const projectStats: ProjectStats = {
  totalLines: 12,
  researched: 5,
  footageFound: 3,
  aiGenerated: 2,
  totalDuration: "1:57",
  estimatedCost: "$854",
};
