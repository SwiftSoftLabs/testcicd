"use client";

import React from "react";
import { CallSessionProvider } from "@/context/CallSessionContext";

export function DashboardCallSession({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CallSessionProvider>{children}</CallSessionProvider>;
}
