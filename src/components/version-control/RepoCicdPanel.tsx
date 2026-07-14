"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

import { useUIContext } from "@/context/UIContext";
import { api } from "@/lib/api";
import type { GitRepoVercelDeploymentStatus } from "@/types/git";

type RepoCicdPanelProps = {
  workspaceId: string;
  projectId: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  productionBranchTipSha?: string | null;
  readOnly?: boolean;
};

function deploymentStateClass(state: string): string {
  const s = state.toUpperCase();
  if (s === "READY" || s === "SUCCESS") return "text-emerald-400";
  if (s === "ERROR" || s === "CANCELED" || s === "FAILED") return "text-red-400";
  if (s === "BUILDING" || s === "QUEUED" || s === "INITIALIZING") return "text-amber-400";
  return "text-text-secondary";
}

export default function RepoCicdPanel({
  workspaceId,
  projectId,
  owner,
  repo,
  defaultBranch,
  productionBranchTipSha,
  readOnly = false,
}: RepoCicdPanelProps) {
  const { addToast } = useUIContext();
  const [status, setStatus] = useState<GitRepoVercelDeploymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingUp, setSettingUp] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [productionBranch, setProductionBranch] = useState(defaultBranch);
  const [vercelProjectName, setVercelProjectName] = useState(`${repo}-onework`);

  const load = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    setLoading(true);
    try {
      const data = await api.integrations.git.vercelDeployments.status(
        workspaceId,
        projectId,
        owner,
        repo,
      );
      setStatus(data);
      if (data.link?.production_branch) {
        setProductionBranch(data.link.production_branch);
      }
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load CI/CD status",
        "error",
      );
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [addToast, owner, projectId, repo, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setProductionBranch(defaultBranch);
    setVercelProjectName(`${repo}-onework`);
  }, [defaultBranch, repo]);

  const handleSetup = async () => {
    if (readOnly) return;
    setSettingUp(true);
    try {
      await api.integrations.git.vercelDeployments.setup({
        workspaceId,
        projectId,
        productionBranch: productionBranch.trim() || defaultBranch,
        vercelProjectName: vercelProjectName.trim() || undefined,
      });
      addToast("Vercel CI/CD configured. Vault secrets synced to Vercel.", "success");
      await load();
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to set up CI/CD",
        "error",
      );
    } finally {
      setSettingUp(false);
    }
  };

  const handleDisconnect = async () => {
    if (readOnly) return;
    setDisconnecting(true);
    try {
      await api.integrations.git.vercelDeployments.disconnect({
        workspaceId,
        projectId,
        owner,
        repo,
      });
      addToast("Vercel CI/CD disconnected.", "warning");
      await load();
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to disconnect CI/CD",
        "error",
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRedeploy = async () => {
    if (readOnly || !status?.link) return;
    const sha = productionBranchTipSha?.trim();
    if (!sha) {
      addToast("Load branches first to get the latest commit SHA.", "warning");
      return;
    }
    setRedeploying(true);
    try {
      await api.integrations.git.vercelDeployments.trigger({
        workspaceId,
        projectId,
        owner,
        repo,
        branch: status.link.production_branch,
        sha,
      });
      addToast("Redeploy triggered.", "success");
      await load();
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to trigger redeploy",
        "error",
      );
    } finally {
      setRedeploying(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-text-secondary text-sm">
        Loading deployments…
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="max-w-2xl space-y-6 animate-in fade-in duration-300">
        <div className="rounded-xl border border-border-dark bg-surface-dark/40 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-primary text-[28px]">
              rocket_launch
            </span>
            <div className="min-w-0 space-y-2">
              <h3 className="text-lg font-bold text-main">Deploy with Vercel</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                Connect this repository to Vercel for automatic deployments on
                push. All Vault secrets from development, preview, and
                production environments will be synced to the linked Vercel
                project.
              </p>
            </div>
          </div>

          {status?.vercelConnected ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              Vercel connected
              {status.link ? null : (
                <>
                  {" "}
                  — next, set up CI/CD for this repository (creates a Vercel
                  project and syncs Vault secrets).
                </>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Connect Vercel in{" "}
              <Link href="/settings/plugins" className="font-bold underline">
                Settings → Plugins
              </Link>{" "}
              before setting up CI/CD.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">
                Production branch
              </span>
              <input
                type="text"
                value={productionBranch}
                onChange={(e) => setProductionBranch(e.target.value)}
                disabled={readOnly || !status?.vercelConnected}
                className="w-full h-9 px-3 rounded-lg border border-border-dark bg-background-dark text-sm text-main disabled:opacity-50"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">
                Vercel project name
              </span>
              <input
                type="text"
                value={vercelProjectName}
                onChange={(e) => setVercelProjectName(e.target.value)}
                disabled={readOnly || !status?.vercelConnected}
                className="w-full h-9 px-3 rounded-lg border border-border-dark bg-background-dark text-sm text-main disabled:opacity-50"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => void handleSetup()}
            disabled={readOnly || settingUp || !status?.vercelConnected}
            className="cursor-pointer h-9 px-4 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-40 inline-flex items-center gap-2"
          >
            {settingUp ? (
              <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined text-[16px]">link</span>
            )}
            Set up CI/CD
          </button>
        </div>
      </div>
    );
  }

  const link = status.link!;
  const vercelProjectUrl = `https://vercel.com/${link.vercel_project_name}`;

  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-main">Deployments</h3>
          <p className="text-sm text-text-secondary mt-1">
            Linked to{" "}
            <a
              href={vercelProjectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-semibold hover:underline"
            >
              {link.vercel_project_name}
            </a>{" "}
            · production branch{" "}
            <span className="font-mono text-main">{link.production_branch}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleRedeploy()}
            disabled={readOnly || redeploying || !productionBranchTipSha}
            className="cursor-pointer h-9 px-3 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-surface-dark disabled:opacity-40 inline-flex items-center gap-2"
          >
            {redeploying ? (
              <span className="size-3 border-2 border-text-secondary/30 border-t-text-secondary rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            )}
            Redeploy
          </button>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
              className="cursor-pointer h-9 px-3 rounded-lg border border-red-500/40 text-red-400 text-xs font-bold hover:bg-red-500/10 disabled:opacity-40"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
        Pushes to this repository trigger Vercel deployments. Build status is
        reported back to pull requests as a <strong>Vercel</strong> check.
      </div>

      {status.recentDeployments.length === 0 ? (
        <p className="text-sm text-text-secondary italic">
          No deployments yet. Push a commit to trigger the first deploy.
        </p>
      ) : (
        <ul className="space-y-2">
          {status.recentDeployments.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-dark bg-surface-dark/40 px-4 py-3 text-sm"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-bold uppercase text-xs ${deploymentStateClass(d.state)}`}
                  >
                    {d.state}
                  </span>
                  {d.target ? (
                    <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">
                      {d.target}
                    </span>
                  ) : null}
                  {d.branch ? (
                    <span className="font-mono text-xs text-text-secondary">
                      {d.branch}
                    </span>
                  ) : null}
                </div>
                {d.sha ? (
                  <p className="font-mono text-xs text-text-secondary truncate">
                    {d.sha.slice(0, 12)}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-text-secondary">
                  {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                </span>
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary text-xs font-bold hover:underline"
                  >
                    Visit
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
