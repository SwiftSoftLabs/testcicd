import type { CalendarDisplayItem } from "@/types/calendar";

export type EventColorSet = {
  bg: string;
  border: string;
  text: string;
  dot: string;
  hoverBorder: string;
};

/** Kelviq-style event pills: pastel fill + saturated label. */
export function getEventColors(item: CalendarDisplayItem): EventColorSet {
  if (item.source === "task") {
    return {
      bg: "light:bg-emerald-50 dark:bg-emerald-500/15",
      border: "light:border-emerald-100 dark:border-emerald-500/25",
      text: "light:text-emerald-700 dark:text-emerald-200",
      dot: "light:bg-emerald-600 dark:bg-emerald-400",
      hoverBorder: "light:hover:border-emerald-200 dark:hover:border-emerald-400",
    };
  }
  if (item.eventSource === "email") {
    return {
      bg: "light:bg-cyan-50 dark:bg-cyan-500/15",
      border: "light:border-cyan-100 dark:border-cyan-500/25",
      text: "light:text-cyan-700 dark:text-cyan-200",
      dot: "light:bg-cyan-600 dark:bg-cyan-400",
      hoverBorder: "light:hover:border-cyan-200 dark:hover:border-cyan-400",
    };
  }
  if (item.eventSource === "plugin") {
    return {
      bg: "light:bg-violet-50 dark:bg-violet-500/15",
      border: "light:border-violet-100 dark:border-violet-500/25",
      text: "light:text-violet-700 dark:text-violet-200",
      dot: "light:bg-violet-600 dark:bg-violet-400",
      hoverBorder: "light:hover:border-violet-200 dark:hover:border-violet-400",
    };
  }
  if (item.eventScope === "account") {
    return {
      bg: "light:bg-amber-50 dark:bg-amber-500/15",
      border: "light:border-amber-100 dark:border-amber-500/25",
      text: "light:text-amber-700 dark:text-amber-200",
      dot: "light:bg-amber-600 dark:bg-amber-400",
      hoverBorder: "light:hover:border-amber-200 dark:hover:border-amber-400",
    };
  }
  if (item.eventScope === "workspace") {
    return {
      bg: "light:bg-blue-50 dark:bg-blue-500/15",
      border: "light:border-blue-100 dark:border-blue-500/25",
      text: "light:text-blue-700 dark:text-blue-200",
      dot: "light:bg-blue-600 dark:bg-blue-400",
      hoverBorder: "light:hover:border-blue-200 dark:hover:border-blue-400",
    };
  }
  return {
    bg: "light:bg-indigo-50 dark:bg-indigo-500/15",
    border: "light:border-indigo-100 dark:border-indigo-500/25",
    text: "light:text-indigo-700 dark:text-indigo-200",
    dot: "light:bg-indigo-600 dark:bg-indigo-400",
    hoverBorder: "light:hover:border-indigo-200 dark:hover:border-indigo-400",
  };
}
