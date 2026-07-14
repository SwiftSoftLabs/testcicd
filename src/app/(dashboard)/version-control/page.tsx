"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useRouter, useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";

import BranchPicker from "@/components/version-control/BranchPicker";
import EmptyVCState from "@/components/version-control/EmptyVCState";
import ProviderConnectBanner from "@/components/version-control/ProviderConnectBanner";
import RepoCicdPanel from "@/components/version-control/RepoCicdPanel";
import RepoBranches from "@/components/version-control/RepoBranches";
import BranchProtectionPanel from "@/components/version-control/BranchProtectionPanel";
import RepoReleases, {
  type RepoReleaseView,
} from "@/components/version-control/RepoReleases";
import { getProviderLabel } from "@/lib/integrations/git/provider-meta";
import RepoCommits from "@/components/version-control/RepoCommits";
import RepoOverview from "@/components/version-control/RepoOverview";
import RepoPicker, {
  type ProviderTabOption,
} from "@/components/version-control/RepoPicker";
import RepoPullRequests from "@/components/version-control/RepoPullRequests";
import { RepoClonePopover } from "@/components/version-control/RepoClonePopover";
import { RepoCollaboratorsPanel } from "@/components/version-control/RepoCollaboratorsPanel";
import ProjectScopeSelect from "@/components/ProjectScopeSelect";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import { useGitIntegrationStatus } from "@/hooks/useGitIntegration";
import { usePageProjectScope } from "@/hooks/usePageProjectScope";
import { api } from "@/lib/api";
import { parseVcPullId } from "@/lib/integrations/git/vc-pull-id";
import { buildOneworkPullShareUrl, buildOneworkCommitShareUrl } from "@/lib/integrations/git/vc-share-url";
import type {
  GitBranchInfo,
  GitCommitDetail,
  GitCommitListItem,
  GitFileTextResult,
  GitIntegrationStatusResponse,
  GitProvider,
  GitPullCreateHint,
  GitRepo,
  GitTreeEntry,
} from "@/types/git";
import type { PullRequest } from "@/types";

type TabId = "overview" | "commits" | "branches" | "pull-requests" | "releases" | "deployments";
type PRDetailTab = "conversation" | "files";

function splitRepoPath(fullName: string): { owner: string; repo: string } {
  const i = fullName.indexOf("/");
  if (i < 0) return { owner: fullName, repo: "" };
  return { owner: fullName.slice(0, i), repo: fullName.slice(i + 1) };
}

function buildProviderOptions(
  status: GitIntegrationStatusResponse | null,
): ProviderTabOption[] {
  if (!status) return [];
  const opts: ProviderTabOption[] = [];

  if (status.oneworkVcConfigured || status.onework) {
    opts.push({
      provider: "onework",
      state:
        status.onework?.status === "connected" ? "connected" : "pending",
      hint: status.oneworkProvisionError ?? undefined,
    });
  }

  if (status.oauthGithubConfigured || status.github) {
    opts.push({
      provider: "github",
      state: status.github?.status === "connected" ? "connected" : "available",
    });
  }

  if (status.oauthGitlabConfigured || status.gitlab) {
    opts.push({
      provider: "gitlab",
      state: status.gitlab?.status === "connected" ? "connected" : "available",
    });
  }

  return opts;
}

function providerCanLoadRepos(
  status: GitIntegrationStatusResponse | null,
  provider: GitProvider,
): boolean {
  if (!status) return false;
  if (provider === "onework") return status.oneworkVcConfigured;
  if (provider === "github") return status.github?.status === "connected";
  if (provider === "gitlab") return status.gitlab?.status === "connected";
  return false;
}

function isExternalProviderConnected(
  status: GitIntegrationStatusResponse | null,
  provider: GitProvider,
): boolean {
  if (!status) return false;
  if (provider === "github") return status.github?.status === "connected";
  if (provider === "gitlab") return status.gitlab?.status === "connected";
  return false;
}

const VersionControlPageInner = () => {
  const { addToast, openModal } = useUIContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appSettings, projects, selectedWorkspaceId, setSelectedProjectId } =
    useAppContext();
  const { selectedProjectId, setProjectId } = usePageProjectScope(projects, {
    storageKey: selectedWorkspaceId
      ? `ow-selected-project-id:${selectedWorkspaceId}`
      : null,
    onProjectChange: setSelectedProjectId,
  });

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const isLockedProject = selectedProject?.quota_locked === true;

  const {
    status,
    loading: statusLoading,
    reload: reloadGitStatus,
  } = useGitIntegrationStatus(selectedWorkspaceId);

  const [provider, setProvider] = useState<GitProvider>("onework");
  const [repos, setRepos] = useState<GitRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitRepo | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [currentBranch, setCurrentBranch] = useState("main");
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [navigationPath, setNavigationPath] = useState<string[]>([]);

  const [contents, setContents] = useState<GitTreeEntry[]>([]);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [readmeMd, setReadmeMd] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);

  const [filePreviewEntry, setFilePreviewEntry] = useState<GitTreeEntry | null>(
    null,
  );
  const [filePreviewData, setFilePreviewData] =
    useState<GitFileTextResult | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);

  const [commits, setCommits] = useState<GitCommitListItem[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [selectedCommitDetail, setSelectedCommitDetail] =
    useState<GitCommitDetail | null>(null);
  const [commitDetailLoading, setCommitDetailLoading] = useState(false);

  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [pullsLoading, setPullsLoading] = useState(false);
  const [tags, setTags] = useState<
    Array<{
      name: string;
      commitSha: string;
      message: string | null;
      createdAt: string | null;
    }>
  >([]);
  const [releases, setReleases] = useState<RepoReleaseView[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [prFilter, setPrFilter] = useState<"open" | "closed">("open");
  const [selectedPR, setSelectedPR] = useState<PullRequest | null>(null);
  const [prDetailTab, setPrDetailTab] = useState<PRDetailTab>("conversation");
  const [prDetailLoading, setPrDetailLoading] = useState(false);
  const [prCreateHint, setPrCreateHint] = useState<GitPullCreateHint | null>(
    null,
  );
  const [createRepoLoading, setCreateRepoLoading] = useState(false);
  const [createRepoError, setCreateRepoError] = useState<string | null>(null);
  const handledQuickPrRef = useRef<string | null>(null);
  const handledPrDeepLinkRef = useRef<string | null>(null);
  const lastRestoredProjectScopeRef = useRef<string | null>(null);

  const selectionStorageKey =
    selectedWorkspaceId && selectedProjectId
      ? `ow-vc-selection:${selectedWorkspaceId}:${selectedProjectId}`
      : null;

  const vcAvailable = Boolean(
    status?.oneworkVcConfigured ||
      status?.onework ||
      status?.github ||
      status?.gitlab ||
      status?.oauthGithubConfigured ||
      status?.oauthGitlabConfigured,
  );

  const providerOptions = useMemo(
    () => buildProviderOptions(status),
    [status],
  );

  const visibleProviders = useMemo(
    () =>
      providerOptions
        .filter((o) => o.state !== "unavailable")
        .map((o) => o.provider),
    [providerOptions],
  );

  const repoPickerEnabled = providerCanLoadRepos(status, provider);

  useEffect(() => {
    if (!selectionStorageKey || visibleProviders.length === 0) return;

    if (lastRestoredProjectScopeRef.current !== selectionStorageKey) {
      lastRestoredProjectScopeRef.current = selectionStorageKey;

      let storedProvider: GitProvider | null = null;
      try {
        const stored = JSON.parse(
          localStorage.getItem(selectionStorageKey) || "null",
        ) as { provider?: GitProvider } | null;
        if (
          stored?.provider &&
          visibleProviders.includes(stored.provider)
        ) {
          storedProvider = stored.provider;
        }
      } catch {
        storedProvider = null;
      }

      if (storedProvider) {
        setProvider(storedProvider);
        return;
      }
    }

    if (!visibleProviders.includes(provider)) {
      const preferred =
        visibleProviders.find(
          (p) =>
            (p === "onework" && status?.oneworkVcConfigured) ||
            (p === "github" && status?.github) ||
            (p === "gitlab" && status?.gitlab),
        ) ?? visibleProviders[0];
      setProvider(preferred);
    }
  }, [selectionStorageKey, visibleProviders, status, provider]);

  const persistSelection = useCallback(
    (next: { provider: GitProvider; fullName: string; branch: string }) => {
      if (!selectionStorageKey) return;
      try {
        localStorage.setItem(selectionStorageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [selectionStorageKey],
  );

  const fetchLinkedRepos = useCallback(async (): Promise<GitRepo[] | null> => {
    if (
      !selectedWorkspaceId ||
      !selectedProjectId ||
      !providerCanLoadRepos(status, provider)
    ) {
      return null;
    }
    return api.integrations.git.linkedRepos.list(
      selectedWorkspaceId,
      selectedProjectId,
      provider,
    );
  }, [selectedWorkspaceId, selectedProjectId, provider, status]);

  const openLinkedReposPicker = useCallback(() => {
    if (!selectedWorkspaceId || !selectedProjectId) {
      addToast("Select a project first.", "warning");
      return;
    }
    openModal("git-linked-repos", {
      workspaceId: selectedWorkspaceId,
      projectId: selectedProjectId,
      provider,
      onSaved: () => {
        void reloadGitStatus();
        void fetchLinkedRepos()
          .then((data) => {
            if (data) setRepos(data);
          })
          .catch((e) => {
            addToast(
              e instanceof Error ? e.message : "Failed to refresh repositories",
              "error",
            );
          });
      },
    });
  }, [
    selectedWorkspaceId,
    selectedProjectId,
    provider,
    openModal,
    addToast,
    reloadGitStatus,
    fetchLinkedRepos,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedWorkspaceId || !selectedProjectId) {
      setRepos([]);
      return;
    }
    if (!providerCanLoadRepos(status, provider)) {
      setRepos([]);
      setSelectedRepo(null);
      return;
    }
    setReposLoading(true);
    void fetchLinkedRepos()
      .then((data) => {
        if (cancelled || data === null) return;
        setRepos(data);
      })
      .catch((e) => {
        if (!cancelled) {
          addToast(
            e instanceof Error ? e.message : "Failed to load repositories",
            "error",
          );
          setRepos([]);
        }
      })
      .finally(() => {
        if (!cancelled) setReposLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    fetchLinkedRepos,
    addToast,
    selectedWorkspaceId,
    selectedProjectId,
    provider,
    status,
  ]);

  useEffect(() => {
    if (!repos.length) {
      setSelectedRepo(null);
      return;
    }
    setSelectedRepo((prev) => {
      if (
        prev &&
        prev.provider === provider &&
        repos.some((r) => r.id === prev.id)
      ) {
        return prev;
      }
      let stored: { fullName?: string; branch?: string } | null = null;
      if (selectionStorageKey) {
        try {
          stored = JSON.parse(
            localStorage.getItem(selectionStorageKey) || "null",
          );
        } catch {
          stored = null;
        }
      }
      const next =
        (stored?.fullName &&
          repos.find((r) => r.fullName === stored.fullName)) ||
        repos.find((r) => r.provider === provider) ||
        repos[0];
      if (next && stored?.branch) {
        setCurrentBranch(stored.branch);
      } else if (next?.defaultBranch) {
        setCurrentBranch(next.defaultBranch);
      }
      return next ?? null;
    });
  }, [repos, provider, selectionStorageKey]);

  const { owner, repo } = useMemo(
    () =>
      selectedRepo
        ? splitRepoPath(selectedRepo.fullName)
        : { owner: "", repo: "" },
    [selectedRepo],
  );

  const loadBranches = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedRepo) return;
    if (selectedRepo.provider !== provider) return;
    setBranchesLoading(true);
    try {
      const b = await api.integrations.git.branches(
        provider,
        selectedWorkspaceId,
        owner,
        repo,
      );
      setBranches(b);
      setCurrentBranch((prev) => {
        if (b.some((x) => x.name === prev)) return prev;
        const def = b.find((x) => x.isDefault)?.name;
        return def || b[0]?.name || prev;
      });
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load branches",
        "error",
      );
      setBranches([]);
    } finally {
      setBranchesLoading(false);
    }
  }, [selectedWorkspaceId, selectedRepo, provider, owner, repo, addToast]);

  useEffect(() => {
    if (!selectedRepo || selectedRepo.provider !== provider || !selectedWorkspaceId) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    setBranchesLoading(true);
    void api.integrations.git
      .branches(provider, selectedWorkspaceId, owner, repo)
      .then((b) => {
        if (cancelled) return;
        setBranches(b);
        setCurrentBranch((prev) => {
          if (b.some((x) => x.name === prev)) return prev;
          const def = b.find((x) => x.isDefault)?.name;
          return def || b[0]?.name || prev;
        });
      })
      .catch((e) => {
        if (cancelled) return;
        addToast(
          e instanceof Error ? e.message : "Failed to load branches",
          "error",
        );
        setBranches([]);
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    selectedWorkspaceId,
    selectedRepo,
    provider,
    owner,
    repo,
    addToast,
  ]);

  const pathStr = navigationPath.length ? navigationPath.join("/") : "";

  useEffect(() => {
    if (
      !selectedWorkspaceId ||
      !selectedRepo ||
      activeTab !== "overview" ||
      selectedRepo.provider !== provider
    ) {
      setContents([]);
      setReadmeMd(null);
      setContentsLoading(false);
      setReadmeLoading(false);
      return;
    }
    let cancelled = false;
    setContentsLoading(true);
    setReadmeLoading(true);
    void (async () => {
      try {
        const [tree, readme] = await Promise.all([
          api.integrations.git.contents(
            provider,
            selectedWorkspaceId,
            owner,
            repo,
            pathStr,
            currentBranch,
          ),
          api.integrations.git
            .readme(provider, selectedWorkspaceId, owner, repo, currentBranch)
            .catch(() => null),
        ]);
        if (cancelled) return;
        setContents(tree);
        setReadmeMd(readme?.content ?? null);
      } catch (e) {
        if (cancelled) return;
        addToast(
          e instanceof Error ? e.message : "Failed to load repository tree",
          "error",
        );
        setContents([]);
        setReadmeMd(null);
      } finally {
        if (!cancelled) {
          setContentsLoading(false);
          setReadmeLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedWorkspaceId,
    selectedRepo,
    activeTab,
    provider,
    owner,
    repo,
    pathStr,
    currentBranch,
    addToast,
  ]);

  useEffect(() => {
    if (
      !filePreviewEntry ||
      filePreviewEntry.type !== "file" ||
      !selectedWorkspaceId ||
      !selectedRepo ||
      selectedRepo.provider !== provider ||
      activeTab !== "overview"
    ) {
      setFilePreviewData(null);
      setFilePreviewError(null);
      setFilePreviewLoading(false);
      return;
    }
    let cancelled = false;
    setFilePreviewLoading(true);
    setFilePreviewError(null);
    void (async () => {
      try {
        const data = await api.integrations.git.file(
          provider,
          selectedWorkspaceId,
          owner,
          repo,
          filePreviewEntry.path,
          currentBranch,
        );
        if (!cancelled) {
          setFilePreviewData(data);
        }
      } catch (e) {
        if (!cancelled) {
          setFilePreviewData(null);
          setFilePreviewError(
            e instanceof Error ? e.message : "Failed to load file",
          );
        }
      } finally {
        if (!cancelled) {
          setFilePreviewLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    filePreviewEntry,
    selectedWorkspaceId,
    selectedRepo,
    activeTab,
    provider,
    owner,
    repo,
    currentBranch,
  ]);

  const loadCommits = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedRepo || activeTab !== "commits")
      return;
    if (selectedRepo.provider !== provider) return;
    setCommitsLoading(true);
    try {
      const c = await api.integrations.git.commits(
        provider,
        selectedWorkspaceId,
        owner,
        repo,
        currentBranch,
        1,
      );
      setCommits(c);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load commits",
        "error",
      );
      setCommits([]);
    } finally {
      setCommitsLoading(false);
    }
  }, [
    selectedWorkspaceId,
    selectedRepo,
    activeTab,
    provider,
    owner,
    repo,
    currentBranch,
    addToast,
  ]);

  useEffect(() => {
    void loadCommits();
  }, [loadCommits]);

  const loadPulls = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedRepo || activeTab !== "pull-requests")
      return;
    if (selectedRepo.provider !== provider) return;
    setPullsLoading(true);
    try {
      const open = await api.integrations.git.pulls(
        provider,
        selectedWorkspaceId,
        owner,
        repo,
        "open",
        1,
      );
      const closed = await api.integrations.git.pulls(
        provider,
        selectedWorkspaceId,
        owner,
        repo,
        "closed",
        1,
      );
      setPullRequests([...open, ...closed]);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load pull requests",
        "error",
      );
      setPullRequests([]);
    } finally {
      setPullsLoading(false);
    }
  }, [
    selectedWorkspaceId,
    selectedRepo,
    activeTab,
    provider,
    owner,
    repo,
    addToast,
  ]);

  const loadTags = useCallback(async () => {
    if (
      !selectedWorkspaceId ||
      !selectedRepo ||
      activeTab !== "releases" ||
      provider !== "onework"
    )
      return;
    setTagsLoading(true);
    try {
      const [tagData, releaseData] = await Promise.all([
        api.integrations.git.tags(selectedWorkspaceId, owner, repo),
        api.integrations.git.releases(selectedWorkspaceId, owner, repo),
      ]);
      setTags(tagData);
      setReleases(releaseData);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load releases",
        "error",
      );
      setTags([]);
      setReleases([]);
    } finally {
      setTagsLoading(false);
    }
  }, [
    selectedWorkspaceId,
    selectedRepo,
    activeTab,
    provider,
    owner,
    repo,
    addToast,
  ]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  useEffect(() => {
    void loadPulls();
  }, [loadPulls]);

  const refreshPrCreateHint = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedRepo || !owner || !repo) {
      setPrCreateHint(null);
      return;
    }
    const base =
      selectedRepo.defaultBranch ||
      branches.find((b) => b.isDefault)?.name ||
      branches[0]?.name ||
      "main";
    const compare = currentBranch;
    if (!compare || base === compare) {
      setPrCreateHint({
        show: false,
        baseBranch: base,
        compareBranch: compare,
        commitsAhead: 0,
        lastActivityAt: null,
      });
      return;
    }
    try {
      const hint = await api.integrations.git.pullCreateHint(
        provider,
        selectedWorkspaceId,
        owner,
        repo,
        base,
        compare,
      );
      setPrCreateHint(hint);
    } catch {
      setPrCreateHint(null);
    }
  }, [
    selectedWorkspaceId,
    selectedRepo,
    owner,
    repo,
    currentBranch,
    branches,
    provider,
  ]);

  useEffect(() => {
    if (!selectedWorkspaceId || !selectedRepo) {
      setPrCreateHint(null);
      return;
    }
    const t = window.setTimeout(() => {
      void refreshPrCreateHint();
    }, 450);
    return () => {
      window.clearTimeout(t);
    };
  }, [
    refreshPrCreateHint,
    selectedWorkspaceId,
    selectedRepo,
    currentBranch,
    branches,
  ]);

  const openNewPrModal = useCallback(
    (opts?: { base?: string; compare?: string }) => {
      if (!selectedWorkspaceId || !selectedRepo) {
        addToast("Select a repository first.", "warning");
        return;
      }
      const defaultBase =
        opts?.base ??
        (selectedRepo.defaultBranch ||
          branches.find((b) => b.isDefault)?.name ||
          branches[0]?.name ||
          currentBranch ||
          "main");
      const defaultCompare = opts?.compare ?? (currentBranch || defaultBase);
      openModal("new-pr", {
        workspaceId: selectedWorkspaceId,
        projectId: selectedProjectId ?? undefined,
        provider,
        owner,
        repo,
        defaultBase,
        defaultCompare,
        branches,
        onCreated: () => {
          void loadPulls();
          void refreshPrCreateHint();
        },
      });
    },
    [
      selectedWorkspaceId,
      selectedRepo,
      branches,
      currentBranch,
      provider,
      owner,
      repo,
      addToast,
      loadPulls,
      refreshPrCreateHint,
    ],
  );

  useEffect(() => {
    const quickPr = searchParams.get("quickPr");
    if (quickPr !== "1") {
      handledQuickPrRef.current = null;
      return;
    }

    const handledKey =
      selectedRepo?.id ??
      `${selectedWorkspaceId ?? "no-workspace"}:${selectedProjectId ?? "no-project"}`;
    if (handledQuickPrRef.current === handledKey) {
      return;
    }

    if (!selectedWorkspaceId) {
      addToast("Select a workspace first.", "warning");
    } else if (reposLoading || branchesLoading) {
      return;
    } else if (!selectedRepo) {
      addToast("Select a repository first.", "warning");
    } else {
      openNewPrModal();
    }

    handledQuickPrRef.current = handledKey;

    const next = new URLSearchParams(searchParams.toString());
    next.delete("quickPr");
    const href = next.toString()
      ? `/version-control?${next.toString()}`
      : "/version-control";
    router.replace(href, { scroll: false });
  }, [
    addToast,
    branchesLoading,
    openNewPrModal,
    reposLoading,
    router,
    searchParams,
    selectedProjectId,
    selectedRepo,
    selectedWorkspaceId,
  ]);

  useEffect(() => {
    const prParam = searchParams.get("pr");
    const projectIdParam = searchParams.get("projectId");
    if (!prParam || !projectIdParam) {
      handledPrDeepLinkRef.current = null;
      return;
    }

    const pullNumber = Number(prParam);
    if (!Number.isFinite(pullNumber) || pullNumber < 1) return;

    const deepLinkKey = `${projectIdParam}:${pullNumber}`;
    if (handledPrDeepLinkRef.current === deepLinkKey) return;
    handledPrDeepLinkRef.current = deepLinkKey;

    router.replace(buildOneworkPullShareUrl(projectIdParam, pullNumber), {
      scroll: false,
    });
  }, [router, searchParams]);

  useEffect(() => {
    const commitParam = searchParams.get("commit");
    const projectIdParam = searchParams.get("projectId");
    if (!commitParam || !projectIdParam) return;
    router.replace(buildOneworkCommitShareUrl(projectIdParam, commitParam), {
      scroll: false,
    });
  }, [router, searchParams]);

  const clearFilePreview = useCallback(() => {
    setFilePreviewEntry(null);
    setFilePreviewData(null);
    setFilePreviewError(null);
  }, []);

  const handleProjectChange = (projectId: string) => {
    setSelectedRepo(null);
    setRepos([]);
    setBranches([]);
    setCommits([]);
    setPullRequests([]);
    setTags([]);
    setReleases([]);
    setSelectedPR(null);
    setSelectedCommitDetail(null);
    setPrDetailTab("conversation");
    setNavigationPath([]);
    clearFilePreview();
    setPrCreateHint(null);
    setProjectId(projectId);
  };

  const handleRepoSelect = (r: GitRepo) => {
    setSelectedRepo(r);
    setProvider(r.provider);
    setNavigationPath([]);
    clearFilePreview();
    setCurrentBranch(r.defaultBranch || "main");
    setPrCreateHint(null);
    persistSelection({
      provider: r.provider,
      fullName: r.fullName,
      branch: r.defaultBranch || "main",
    });
  };

  const handleProviderChange = (p: GitProvider) => {
    setProvider(p);
    setSelectedRepo(null);
    setNavigationPath([]);
    clearFilePreview();
    setCommits([]);
    setPullRequests([]);
    setSelectedPR(null);
    setPrCreateHint(null);
    setCreateRepoError(null);
    setBranches([]);
    setContents([]);
    setReadmeMd(null);
    if (selectionStorageKey) {
      try {
        const prev = JSON.parse(
          localStorage.getItem(selectionStorageKey) || "null",
        ) as { fullName?: string; branch?: string } | null;
        localStorage.setItem(
          selectionStorageKey,
          JSON.stringify({
            provider: p,
            fullName: prev?.fullName,
            branch: prev?.branch,
          }),
        );
      } catch {
        /* ignore */
      }
    }
  };

  const handleConnectProvider = (p: GitProvider) => {
    setProvider(p);
  };

  const handleCreateOneworkRepo = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedProjectId || isLockedProject) return;
    setCreateRepoLoading(true);
    setCreateRepoError(null);
    try {
      const created = await api.integrations.git.onework.createProjectRepo(
        selectedWorkspaceId,
        selectedProjectId,
      );
      setRepos(created);
      if (created[0]) {
        setSelectedRepo(created[0]);
        setProvider("onework");
        setNavigationPath([]);
        clearFilePreview();
        setCurrentBranch(created[0].defaultBranch || "main");
        persistSelection({
          provider: "onework",
          fullName: created[0].fullName,
          branch: created[0].defaultBranch || "main",
        });
      }
      addToast("Repository created", "success");
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to create repository";
      setCreateRepoError(msg);
      addToast(msg, "error");
    } finally {
      setCreateRepoLoading(false);
    }
  }, [
    selectedWorkspaceId,
    selectedProjectId,
    isLockedProject,
    addToast,
    persistSelection,
    clearFilePreview,
  ]);

  useEffect(() => {
    if (selectedRepo) {
      persistSelection({
        provider,
        fullName: selectedRepo.fullName,
        branch: currentBranch,
      });
    }
  }, [selectedRepo, currentBranch, provider, persistSelection]);

  const handleBranchChange = (name: string) => {
    setCurrentBranch(name);
    setNavigationPath([]);
    clearFilePreview();
    if (selectedRepo)
      persistSelection({
        provider,
        fullName: selectedRepo.fullName,
        branch: name,
      });
  };

  const handleOpenEntry = (entry: GitTreeEntry) => {
    if (entry.type === "folder") {
      clearFilePreview();
      setNavigationPath((prev) => [...prev, entry.name]);
      return;
    }
    setFilePreviewEntry(entry);
  };

  const handleSelectCommit = async (sha: string) => {
    if (!selectedWorkspaceId || !selectedRepo) return;
    setCommitDetailLoading(true);
    setSelectedCommitDetail(null);
    try {
      const d = await api.integrations.git.commitDetail(
        provider,
        selectedWorkspaceId,
        owner,
        repo,
        sha,
      );
      setSelectedCommitDetail(d);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load commit",
        "error",
      );
    } finally {
      setCommitDetailLoading(false);
    }
  };

  const handleSelectPR = async (pr: PullRequest) => {
    setPrDetailTab("files");
    const parsed = parseVcPullId(pr.id);
    if (!parsed || !selectedWorkspaceId || !selectedRepo) return;
    setSelectedPR(null);
    setPrDetailLoading(true);
    try {
      const { pullRequest, diffFiles } = await api.integrations.git.pullDetail(
        parsed.provider,
        selectedWorkspaceId,
        owner,
        repo,
        parsed.number,
      );
      setSelectedPR({ ...pullRequest, diffFiles });
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load pull request",
        "error",
      );
    } finally {
      setPrDetailLoading(false);
    }
  };

  const refreshSelectedPR = useCallback(async () => {
    const pr = selectedPR;
    if (!pr || !selectedWorkspaceId || !selectedRepo) return;
    const parsed = parseVcPullId(pr.id);
    if (!parsed) return;
    try {
      const { pullRequest, diffFiles } = await api.integrations.git.pullDetail(
        parsed.provider,
        selectedWorkspaceId,
        owner,
        repo,
        parsed.number,
      );
      setSelectedPR({ ...pullRequest, diffFiles });
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to refresh pull request",
        "error",
      );
    }
  }, [selectedPR, selectedWorkspaceId, selectedRepo, owner, repo, addToast]);

  const patchSelectedPR = useCallback((patch: Partial<PullRequest>) => {
    setSelectedPR((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  if (!selectedWorkspaceId || statusLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-background-dark">
        <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!vcAvailable) {
    return <EmptyVCState />;
  }

  if (projects.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background-dark p-8">
        <div className="max-w-lg border border-border-dark rounded-2xl bg-surface-dark p-8 text-center">
          <span className="material-symbols-outlined text-primary text-4xl mb-3">
            folder_special
          </span>
          <h2 className="text-xl font-black text-main mb-2">
            Create a project
          </h2>
          <p className="text-sm text-text-secondary mb-6">
            Version Control lists repositories per workspace project (main branch copy).
            Add a project to this workspace, then link repositories for it under Git
            &amp; SSH settings.
          </p>
          <a
            href="/settings/git-ssh"
            className="inline-flex px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold"
          >
            Open Git &amp; SSH
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background-dark overflow-hidden">
      <header className="px-3 sm:px-6 py-3 sm:py-4 border-b border-border-dark bg-surface-dark/20 shrink-0">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
            <div className="flex flex-col gap-1 min-w-0 sm:flex-1">
              <ProjectScopeSelect
                projects={projects}
                selectedProjectId={selectedProjectId}
                onChange={handleProjectChange}
                className="w-[260px]"
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 min-w-0">
                <RepoPicker
                  providerOptions={providerOptions}
                  provider={provider}
                  onProviderChange={handleProviderChange}
                  onConnectProvider={handleConnectProvider}
                  repos={repos}
                  reposLoading={reposLoading}
                  selected={selectedRepo}
                  onSelect={handleRepoSelect}
                  onManageRepos={
                    isLockedProject ||
                    provider === "onework" ||
                    !isExternalProviderConnected(status, provider)
                      ? undefined
                      : openLinkedReposPicker
                  }
                  onCreateRepo={
                    provider === "onework" &&
                    status?.oneworkVcConfigured &&
                    !isLockedProject
                      ? () => void handleCreateOneworkRepo()
                      : undefined
                  }
                  createRepoLoading={createRepoLoading}
                  disabled={isLockedProject}
                  repoPickerEnabled={repoPickerEnabled}
                />
                {selectedRepo && (
                  <>
                    <span
                      className="hidden sm:block h-8 w-px bg-border-dark shrink-0"
                      aria-hidden
                    />
                    <h2 className="text-lg sm:text-xl font-bold text-main truncate max-w-[160px] md:max-w-xs leading-none flex items-center min-h-10">
                      {selectedRepo.name}
                    </h2>
                    {appSettings.developerMode && (
                      <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                        DEV
                      </span>
                    )}
                    <BranchPicker
                      branches={branches}
                      currentBranch={currentBranch}
                      onChange={handleBranchChange}
                      show={showBranchSelector}
                      onToggle={() => setShowBranchSelector((s) => !s)}
                      onToast={(msg, variant) => addToast(msg, variant)}
                      disabled={isLockedProject}
                    />
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <button
                type="button"
                disabled={isLockedProject || !selectedRepo}
                onClick={() => setShowCollaborators(true)}
                className="h-9 px-2.5 sm:px-4 rounded-lg bg-surface-highlight border border-border-dark text-main text-sm font-medium hover:bg-white/5 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Collaborators"
              >
                <span className="material-symbols-outlined text-[18px]">group</span>
                <span className="hidden sm:inline">Collaborators</span>
              </button>
              <button
                type="button"
                disabled={isLockedProject}
                onClick={() => {
                  if (!selectedWorkspaceId || !selectedRepo) {
                    addToast("Select a repository first.", "warning");
                    return;
                  }
                  openModal("invite-repo-collaborator", {
                    workspaceId: selectedWorkspaceId,
                    provider,
                    owner,
                    repo,
                    repoFullName: selectedRepo.fullName,
                  });
                }}
                className="h-9 px-2.5 sm:px-4 rounded-lg bg-surface-highlight border border-border-dark text-main text-sm font-medium hover:bg-white/5 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Invite collaborator"
              >
                <span className="material-symbols-outlined text-[18px]">person_add</span>
                <span className="hidden sm:inline">Invite</span>
              </button>
              <RepoClonePopover
                repo={selectedRepo}
                disabled={!selectedRepo || isLockedProject}
                align="end"
                oneworkSshHost={status?.oneworkSshHost}
                oneworkSshPort={status?.oneworkSshPort}
              />
              <button
                type="button"
                disabled={isLockedProject}
                onClick={() => !isLockedProject && openNewPrModal()}
                className="h-9 px-2.5 sm:px-4 rounded-lg bg-primary hover:bg-blue-600 text-white text-sm font-bold shadow-lg shadow-primary/20 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">merge_type</span>
                <span className="hidden sm:inline">New PR</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1 sm:pt-2">
            <div className="flex gap-0.5 sm:gap-1 p-1 bg-surface-dark rounded-lg border border-border-dark">
              {(
                [
                  {
                    id: "overview" as const,
                    label: "Overview",
                    icon: "overview",
                  },
                  { id: "commits" as const, label: "Commits", icon: "history" },
                  {
                    id: "branches" as const,
                    label: "Branches",
                    icon: "call_split",
                  },
                  {
                    id: "pull-requests" as const,
                    label: "Pull Requests",
                    icon: "merge_type",
                  },
                  ...(provider === "onework"
                    ? [
                        {
                          id: "releases" as const,
                          label: "Releases",
                          icon: "sell",
                        },
                        {
                          id: "deployments" as const,
                          label: "Deployments",
                          icon: "rocket_launch",
                        },
                      ]
                    : []),
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  disabled={isLockedProject}
                  onClick={() => {
                    if (isLockedProject) return;
                    setActiveTab(tab.id);
                    setSelectedPR(null);
                    setSelectedCommitDetail(null);
                    setPrDetailTab("conversation");
                    if (tab.id !== "overview") {
                      clearFilePreview();
                    }
                  }}
                  className={`px-2 sm:px-4 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all ${
                    activeTab === tab.id
                      ? "bg-primary text-white shadow-lg shadow-primary/20"
                      : "text-text-secondary hover:text-main"
                  } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-secondary`}
                >
                  <span
                    className={`material-symbols-outlined text-[16px] ${activeTab === tab.id ? "fill-1" : ""}`}
                  >
                    {tab.icon}
                  </span>
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {isLockedProject && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-amber-400 text-[20px] shrink-0">
            lock
          </span>
          <p className="text-sm text-amber-200">
            This project is read-only because your workspace is over its plan
            limit.{" "}
            <button
              type="button"
              onClick={() =>
                openModal("plan-comparison", {
                  workspaceId: selectedWorkspaceId,
                })
              }
              className="cursor-pointer font-bold underline underline-offset-2 hover:text-amber-100"
            >
              Upgrade to restore editing.
            </button>
          </p>
        </div>
      )}

      {selectedRepo && prCreateHint?.show ? (
        <div className="shrink-0 border-b border-primary/35 bg-primary/10 px-3 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0 flex gap-3">
            <span
              className="material-symbols-outlined text-primary shrink-0 text-[22px]"
              aria-hidden
            >
              bolt
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-main leading-snug">
                <span className="font-mono text-primary">
                  {prCreateHint.compareBranch}
                </span>
                {prCreateHint.lastActivityAt ? (
                  <>
                    {" "}
                    had recent pushes
                    <span className="text-text-secondary font-normal">
                      {" "}
                      (
                      <time dateTime={prCreateHint.lastActivityAt}>
                        {formatDistanceToNow(
                          new Date(prCreateHint.lastActivityAt),
                          {
                            addSuffix: true,
                          },
                        )}
                      </time>
                      )
                    </span>
                    .
                  </>
                ) : (
                  <span className="text-text-secondary font-normal">
                    {" "}
                    has new commits on the remote.
                  </span>
                )}
              </p>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                <span className="font-mono text-main">
                  {prCreateHint.commitsAhead}
                </span>{" "}
                {prCreateHint.commitsAhead === 1 ? "commit" : "commits"} ahead
                of{" "}
                <span className="font-mono text-main">
                  {prCreateHint.baseBranch}
                </span>
                {" · "}
                no open pull request from this branch yet.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isLockedProject}
              onClick={() =>
                !isLockedProject && openNewPrModal({
                  base: prCreateHint.baseBranch,
                  compare: prCreateHint.compareBranch,
                })
              }
              className="shrink-0 h-9 px-4 rounded-lg bg-primary hover:bg-blue-600 text-white text-xs font-bold shadow-md shadow-primary/20 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px]">
                call_merge
              </span>
              Compare &amp; open pull request
            </button>
            {selectedProjectId ? (
              <a
                href={`/version-control/compare?projectId=${encodeURIComponent(selectedProjectId)}&base=${encodeURIComponent(prCreateHint.baseBranch)}&head=${encodeURIComponent(prCreateHint.compareBranch)}`}
                className="shrink-0 h-9 px-4 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-white/5 inline-flex items-center justify-center gap-2"
              >
                View compare
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto no-scrollbar p-3 sm:p-6 bg-background-dark">
        {provider === "onework" &&
          status?.oneworkVcConfigured &&
          !status.onework && (
            <ProviderConnectBanner
              provider="onework"
              variant="onework-pending"
              provisionError={
                createRepoError ?? status.oneworkProvisionError ?? null
              }
              onRetry={() => void reloadGitStatus()}
              retryLoading={statusLoading}
            />
          )}

        {(provider === "github" || provider === "gitlab") &&
          !isExternalProviderConnected(status, provider) && (
            <ProviderConnectBanner
              provider={provider}
              variant="connect"
              oauthStartUrl={
                selectedWorkspaceId && selectedProjectId
                  ? api.integrations.git.oauthStartUrl(
                      provider,
                      selectedWorkspaceId,
                      selectedProjectId,
                      "/version-control",
                    )
                  : undefined
              }
            />
          )}

        {repoPickerEnabled && !reposLoading && repos.length === 0 && (
            <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-main">
                  {provider === "onework"
                    ? "No repository for this project yet"
                    : "No repositories linked for this project"}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  {provider === "onework"
                    ? "Create a shared Git repository for this project on OneWork Version Control."
                    : `Choose which ${getProviderLabel(provider)} repositories appear here. Each project can have its own list.`}
                </p>
                {provider === "onework" && createRepoError && (
                  <p className="text-xs text-amber-300 mt-2">{createRepoError}</p>
                )}
              </div>
              {provider === "onework" ? (
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isLockedProject || createRepoLoading}
                    onClick={() => void handleCreateOneworkRepo()}
                    className="h-9 px-4 rounded-lg bg-primary hover:bg-blue-600 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {createRepoLoading ? "Creating…" : "Create repository"}
                  </button>
                  {!status?.onework && (
                    <button
                      type="button"
                      disabled={statusLoading}
                      onClick={() => void reloadGitStatus()}
                      className="h-9 px-4 rounded-lg border border-border-dark bg-surface-dark text-sm font-bold text-main hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Retry setup
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isLockedProject}
                  onClick={() => !isLockedProject && openLinkedReposPicker()}
                  className="shrink-0 h-9 px-4 rounded-lg bg-primary hover:bg-blue-600 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Link existing repositories
                </button>
              )}
            </div>
          )}
        {!selectedRepo && (
          <div className="text-center text-text-secondary text-sm py-16">
            {reposLoading
              ? "Loading repositories…"
              : !repoPickerEnabled
                ? `Connect ${getProviderLabel(provider)} to browse repositories.`
                : repos.length === 0
                  ? provider === "onework"
                    ? "Create a repository for this project to continue."
                    : "Link at least one repository for this project to continue."
                  : "Select a repository to get started."}
          </div>
        )}
        {selectedRepo && activeTab === "overview" && (
          <RepoOverview
            repo={selectedRepo}
            repoName={selectedRepo.name}
            provider={provider}
            branch={currentBranch}
            contents={contents}
            contentsLoading={contentsLoading}
            navigationPath={navigationPath}
            onNavRoot={() => {
              setNavigationPath([]);
              clearFilePreview();
            }}
            onBreadcrumb={(i) => {
              clearFilePreview();
              setNavigationPath((p) => p.slice(0, i + 1));
            }}
            onOpenEntry={handleOpenEntry}
            readmeMarkdown={readmeMd}
            readmeLoading={readmeLoading}
            previewFile={filePreviewEntry}
            previewData={filePreviewData}
            previewLoading={filePreviewLoading}
            previewError={filePreviewError}
            onClosePreview={clearFilePreview}
            oneworkSshHost={status?.oneworkSshHost}
            oneworkSshPort={status?.oneworkSshPort}
          />
        )}
        {selectedRepo && activeTab === "commits" && (
          <RepoCommits
            commits={commits}
            loading={commitsLoading}
            selectedDetail={selectedCommitDetail}
            loadingDetail={commitDetailLoading}
            onSelect={handleSelectCommit}
            onBack={() => setSelectedCommitDetail(null)}
            gitProvider={provider}
          />
        )}
        {selectedRepo && activeTab === "branches" && (
          <div className="space-y-6">
            <RepoBranches
              branches={branchesLoading ? [] : branches}
              currentBranch={currentBranch}
              onSwitch={(name) => {
                handleBranchChange(name);
                addToast(`Switched to ${name}`, "success");
              }}
              readOnly={isLockedProject}
              allowCreate={provider === "onework"}
              onCreateBranch={
                provider === "onework" && selectedWorkspaceId
                  ? async (branchName, fromRef) => {
                      await api.integrations.git.createBranch(
                        selectedWorkspaceId,
                        owner,
                        repo,
                        branchName,
                        fromRef,
                      );
                      await loadBranches();
                      addToast(`Created branch ${branchName}`, "success");
                    }
                  : undefined
              }
            />
            {selectedProjectId && selectedWorkspaceId ? (
              <BranchProtectionPanel
                workspaceId={selectedWorkspaceId}
                projectId={selectedProjectId}
                readOnly={isLockedProject}
              />
            ) : null}
          </div>
        )}
        {selectedRepo && activeTab === "releases" && provider === "onework" && (
          <RepoReleases
            releases={releases}
            tags={tags}
            loading={tagsLoading}
            readOnly={isLockedProject}
            defaultTarget={currentBranch || "main"}
            onCreate={
              selectedWorkspaceId && !isLockedProject
                ? async (input) => {
                    await api.integrations.git.createRelease(
                      selectedWorkspaceId,
                      owner,
                      repo,
                      input,
                    );
                    addToast("Release created", "success");
                    await loadTags();
                  }
                : undefined
            }
          />
        )}
        {selectedRepo &&
          activeTab === "deployments" &&
          provider === "onework" &&
          selectedProjectId &&
          selectedWorkspaceId && (
            <RepoCicdPanel
              workspaceId={selectedWorkspaceId}
              projectId={selectedProjectId}
              owner={owner}
              repo={repo}
              defaultBranch={selectedRepo.defaultBranch || currentBranch || "main"}
              productionBranchTipSha={
                branches.find(
                  (b) =>
                    b.name ===
                    (selectedRepo.defaultBranch || currentBranch || "main"),
                )?.lastCommitSha ?? null
              }
              readOnly={isLockedProject}
            />
          )}
        {selectedRepo && activeTab === "pull-requests" && (
          <RepoPullRequests
            pullRequests={pullsLoading ? [] : pullRequests}
            loading={pullsLoading}
            prFilter={prFilter}
            onPrFilter={setPrFilter}
            selectedPR={selectedPR}
            onSelectPR={handleSelectPR}
            onBack={() => setSelectedPR(null)}
            prDetailTab={prDetailTab}
            onPrDetailTab={setPrDetailTab}
            loadingDetail={prDetailLoading}
            workspaceId={selectedWorkspaceId ?? ""}
            projectId={selectedProjectId ?? ""}
            projectName={selectedProject?.name ?? null}
            gitProvider={selectedRepo.provider}
            owner={owner}
            repo={repo}
            onRefreshSelectedPR={refreshSelectedPR}
            onRefreshPullList={loadPulls}
            onPatchSelectedPR={patchSelectedPR}
            readOnly={isLockedProject}
          />
        )}
        <div className="h-20" />
      </div>
      {selectedWorkspaceId && selectedRepo ? (
        <RepoCollaboratorsPanel
          open={showCollaborators}
          onClose={() => setShowCollaborators(false)}
          workspaceId={selectedWorkspaceId}
          provider={provider}
          owner={owner}
          repo={repo}
          repoFullName={selectedRepo.fullName}
          readOnly={isLockedProject}
          onInvite={() => {
            setShowCollaborators(false);
            openModal("invite-repo-collaborator", {
              workspaceId: selectedWorkspaceId,
              provider,
              owner,
              repo,
              repoFullName: selectedRepo.fullName,
            });
          }}
        />
      ) : null}
    </div>
  );
};

export default function VersionControlPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center bg-background-dark">
          <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <VersionControlPageInner />
    </Suspense>
  );
}
