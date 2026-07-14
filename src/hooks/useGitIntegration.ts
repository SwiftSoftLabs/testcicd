"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { GitIntegrationStatusResponse } from "@/types/git";
import { api } from "@/lib/api";

export function useGitIntegrationStatus(workspaceId: string | null) {
  const [status, setStatus] = useState<GitIntegrationStatusResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const data = await api.integrations.git.status(workspaceId);
      setStatus(data);
    } catch {
      setStatus({
        onework: null,
        github: null,
        gitlab: null,
        oneworkVcConfigured: false,
        oauthGithubConfigured: false,
        oauthGitlabConfigured: false,
      });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, loading, reload };
}
