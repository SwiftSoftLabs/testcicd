"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

export interface AssistantPageContextBridgeValue {
  conversationId: string | null;
  emailMessageId: string | null;
  taskId: string | null;
  setConversationId: (id: string | null) => void;
  setEmailMessageId: (id: string | null) => void;
  setTaskId: (id: string | null) => void;
}

const AssistantPageContextBridgeContext = createContext<
  AssistantPageContextBridgeValue | undefined
>(undefined);

export function AssistantPageContextBridgeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [emailMessageId, setEmailMessageId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const value = useMemo(
    () => ({
      conversationId,
      emailMessageId,
      taskId,
      setConversationId,
      setEmailMessageId,
      setTaskId,
    }),
    [conversationId, emailMessageId, taskId],
  );

  return (
    <AssistantPageContextBridgeContext.Provider value={value}>
      {children}
    </AssistantPageContextBridgeContext.Provider>
  );
}

export function useAssistantPageContextBridge(): AssistantPageContextBridgeValue {
  const ctx = useContext(AssistantPageContextBridgeContext);
  if (!ctx) {
    return {
      conversationId: null,
      emailMessageId: null,
      taskId: null,
      setConversationId: () => {},
      setEmailMessageId: () => {},
      setTaskId: () => {},
    };
  }
  return ctx;
}
