export interface HomepageProject {
  id: string;
  slug: string;
  name: string;
  client: string;
  category: string;
  tags: string[];
  description: string;
  biome: "blue" | "purple" | "teal" | "coral";
  uiColorPrimary: string;
  uiColorSecondary: string;
  videoSrc: string | null;
  posterSrc: string | null;
}

export const HOMEPAGE_PROJECTS: HomepageProject[] = [
  {
    id: "1",
    slug: "unified-workspace",
    name: "Unified Workspace",
    client: "OneWork",
    category: "Platform",
    tags: ["WEBSITES", "MULTIPLAYER"],
    description:
      "A single command center for tasks, files, comms, and code reviews. Everything a team needs, nothing it doesn't.",
    biome: "blue",
    uiColorPrimary: "#3B82F6",
    uiColorSecondary: "#F1F5F9",
    videoSrc: null,
    posterSrc: null,
  },
  {
    id: "2",
    slug: "realtime-collab",
    name: "Realtime Collaboration",
    client: "OneWork",
    category: "Multiplayer",
    tags: ["MULTIPLAYER", "WEBSITES"],
    description:
      "Presence indicators, live cursors, and instant sync across every surface — built on a WebSocket-first architecture.",
    biome: "purple",
    uiColorPrimary: "#8B5CF6",
    uiColorSecondary: "#3B82F6",
    videoSrc: null,
    posterSrc: null,
  },
  {
    id: "3",
    slug: "sprint-engine",
    name: "Sprint Engine",
    client: "Engineering Teams",
    category: "Task Management",
    tags: ["WEBSITES"],
    description:
      "Kanban boards, sprint planning, burndown charts, and velocity tracking — all connected to your git workflow.",
    biome: "teal",
    uiColorPrimary: "#14B8A6",
    uiColorSecondary: "#3B82F6",
    videoSrc: null,
    posterSrc: null,
  },
  {
    id: "4",
    slug: "smart-inbox",
    name: "Smart Inbox",
    client: "Remote Teams",
    category: "Communications",
    tags: ["WEBSITES", "MULTIPLAYER"],
    description:
      "Email, chat, and notifications unified in one adaptive inbox. AI-prioritized, context-aware, zero noise.",
    biome: "coral",
    uiColorPrimary: "#EF4444",
    uiColorSecondary: "#8B5CF6",
    videoSrc: null,
    posterSrc: null,
  },
  {
    id: "5",
    slug: "file-intelligence",
    name: "File Intelligence",
    client: "Design Teams",
    category: "Storage",
    tags: ["WEBSITES"],
    description:
      "Version-controlled cloud storage with instant preview, smart search, and attachment linking to tasks and messages.",
    biome: "purple",
    uiColorPrimary: "#8B5CF6",
    uiColorSecondary: "#14B8A6",
    videoSrc: null,
    posterSrc: null,
  },
  {
    id: "6",
    slug: "code-bridge",
    name: "Code Bridge",
    client: "Dev Teams",
    category: "Version Control",
    tags: ["WEBSITES", "GAMES"],
    description:
      "GitHub and GitLab integration with commit timelines, PR review, and branch management — inside your workspace.",
    biome: "blue",
    uiColorPrimary: "#3B82F6",
    uiColorSecondary: "#3B82F6",
    videoSrc: null,
    posterSrc: null,
  },
];
