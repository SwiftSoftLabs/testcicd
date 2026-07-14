"use client";

import React, {
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { CallAiSidebar } from "@/components/calls/CallAiSidebar";
import type { ComponentProps } from "react";
import type { LiveSttCaption } from "@/types/calls";

type CallAiSidebarProps = ComponentProps<typeof CallAiSidebar>;

export type CallAiSidebarHostHandle = {
  setLiveSttCaption: (caption: LiveSttCaption | null) => void;
};

type CallAiSidebarHostProps = Omit<CallAiSidebarProps, "liveSttCaption">;

export const CallAiSidebarHost = forwardRef<
  CallAiSidebarHostHandle,
  CallAiSidebarHostProps
>(function CallAiSidebarHost(props, ref) {
  const [liveSttCaption, setLiveSttCaption] = useState<LiveSttCaption | null>(
    null,
  );

  useImperativeHandle(ref, () => ({ setLiveSttCaption }), []);

  return <CallAiSidebar {...props} liveSttCaption={liveSttCaption} />;
});
