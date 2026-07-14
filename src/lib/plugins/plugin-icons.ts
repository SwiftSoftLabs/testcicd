/** Public SVG assets under /public — used in chat, settings, and plugin cards. */

export const PLUGIN_ICON_PATHS = {
  slack: "/slack.svg",
  teams: "/teams.svg",
  discord: "/discord.svg",
  microsoft: "/microsoft.svg",
  google: "/google.svg",
  trello: "/trello.svg",
  jira: "/jira.svg",
  clickup: "/clickup.svg",
  asana: "/asana.svg",
  outlook: "/microsoft.svg",
  google_calendar: "/google.svg",
  calendly: "/calendly.svg",
  vercel: "/vercel.svg",
  zoom: "/zoom.svg",
  custom_mail: "/globe.svg",
} as const;

export type PluginIconId = keyof typeof PLUGIN_ICON_PATHS;

export function pluginIconPath(id: PluginIconId): string {
  return PLUGIN_ICON_PATHS[id];
}

export function chatPluginIconId(provider: "slack" | "teams" | "discord"): PluginIconId {
  if (provider === "teams") return "teams";
  return provider;
}

export function taskPluginIconId(
  provider: "trello" | "jira" | "clickup" | "asana",
): PluginIconId {
  return provider;
}

export function calendarPluginIconId(
  provider: "google_calendar" | "outlook" | "calendly",
): PluginIconId {
  if (provider === "outlook") return "outlook";
  if (provider === "calendly") return "calendly";
  return "google_calendar";
}
