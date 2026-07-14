"use client";

import React from "react";
import type { Presence } from "@/lib/presence";

interface PresenceDotProps {
  status: Presence;
  size?: "sm" | "md";
  ring?: boolean;
  title?: string;
}

const SIZE_CLASS = {
  sm: "size-2",
  md: "size-3",
} as const;

const STATUS_CLASS = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  offline: "bg-transparent border border-text-secondary/40",
  invited: "bg-slate-500",
} as const;

export default function PresenceDot({
  status,
  size = "sm",
  ring = false,
  title,
}: PresenceDotProps) {
  return (
    <span
      title={title}
      className={`inline-block rounded-full shrink-0 ${SIZE_CLASS[size]} ${STATUS_CLASS[status]} ${
        ring ? "ring-2 ring-surface-dark" : ""
      }`}
    />
  );
}
