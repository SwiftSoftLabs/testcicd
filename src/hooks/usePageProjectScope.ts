"use client";

import { useEffect, useMemo, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Project } from "@/types";

interface PageProjectScopeOptions {
  storageKey?: string | null;
  syncUrl?: boolean;
  projectsReady?: boolean;
  onProjectChange?: (projectId: string | null) => void;
}

export function usePageProjectScope(
  projects: Project[],
  {
    storageKey,
    syncUrl = true,
    projectsReady = true,
    onProjectChange,
  }: PageProjectScopeOptions = {},
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const urlProjectId = searchParams.get("projectId");
  const rawProjectId = syncUrl ? urlProjectId : null;
  const [storedProjectId, setStoredProjectId] = useState<string | null>(() => {
    if (!storageKey || typeof window === "undefined") return null;
    return localStorage.getItem(storageKey);
  });

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      setStoredProjectId(null);
      return;
    }
    setStoredProjectId(localStorage.getItem(storageKey));
  }, [storageKey]);

  const selectedProjectId = useMemo(() => {
    if (projects.length === 0) return null;
    if (
      rawProjectId &&
      projects.some((project) => project.id === rawProjectId)
    ) {
      return rawProjectId;
    }
    if (
      storedProjectId &&
      projects.some((project) => project.id === storedProjectId)
    ) {
      return storedProjectId;
    }
    return projects[0].id;
  }, [projects, rawProjectId, storedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const persistProjectId = useCallback(
    (projectId: string | null) => {
      setStoredProjectId(projectId);
      if (!storageKey || typeof window === "undefined") return;
      if (projectId) localStorage.setItem(storageKey, projectId);
      else localStorage.removeItem(storageKey);
    },
    [storageKey],
  );

  const replaceIfChanged = useCallback(
    (nextQuery: string) => {
      if (searchParamsString === nextQuery) return;
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParamsString],
  );

  const setProjectId = useCallback(
    (projectId: string) => {
      if (!pathname || !projectId) return;
      persistProjectId(projectId);
      if (!syncUrl) return;
      const next = new URLSearchParams(searchParamsString);
      next.set("projectId", projectId);
      const query = next.toString();
      replaceIfChanged(query);
    },
    [pathname, persistProjectId, replaceIfChanged, searchParamsString, syncUrl],
  );

  useEffect(() => {
    if (!pathname) return;

    if (!projectsReady) return;

    if (!syncUrl && urlProjectId) {
      const next = new URLSearchParams(searchParamsString);
      next.delete("projectId");
      replaceIfChanged(next.toString());
    }

    if (projects.length === 0) {
      persistProjectId(null);
      onProjectChange?.(null);
      if (syncUrl && rawProjectId) {
        const next = new URLSearchParams(searchParamsString);
        next.delete("projectId");
        replaceIfChanged(next.toString());
      }
      return;
    }

    if (!selectedProjectId) return;
    onProjectChange?.(selectedProjectId);
    if (storedProjectId !== selectedProjectId) {
      persistProjectId(selectedProjectId);
    }
    if (!syncUrl) return;
    if (rawProjectId === selectedProjectId) return;
    const next = new URLSearchParams(searchParamsString);
    next.set("projectId", selectedProjectId);
    replaceIfChanged(next.toString());
  }, [
    onProjectChange,
    pathname,
    persistProjectId,
    projects.length,
    projectsReady,
    rawProjectId,
    replaceIfChanged,
    searchParamsString,
    selectedProjectId,
    storedProjectId,
    syncUrl,
    urlProjectId,
  ]);

  return { selectedProjectId, selectedProject, setProjectId };
}
