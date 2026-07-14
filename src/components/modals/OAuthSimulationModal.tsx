"use client";

import React, { useMemo, useState } from "react";

import type { GitProvider } from "@/types/git";

import { api } from "@/lib/api";

export interface OAuthSimulationModalProps {
  onClose: () => void;
  onConnected?: () => void | Promise<void>;
  /** Called after PAT flow closes the modal (e.g. open repository picker) */
  afterSessionEstablished?: () => void;
  provider: GitProvider;
  workspaceId: string;
  projectId: string;
  oauthConfigured: boolean;
}

const TAB_OAUTH = "oauth" as const;
const TAB_PAT = "pat" as const;
type Tab = typeof TAB_OAUTH | typeof TAB_PAT;

const OAuthSimulationModal: React.FC<OAuthSimulationModalProps> = ({
  onClose,
  onConnected,
  afterSessionEstablished,
  provider,
  workspaceId,
  projectId,
  oauthConfigured,
}) => {
  const [tab, setTab] = useState<Tab>(oauthConfigured ? TAB_OAUTH : TAB_PAT);
  const [pat, setPat] = useState("");
  const [patSubmitting, setPatSubmitting] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);

  const providerLabel = useMemo(
    () => (provider === "github" ? "GitHub" : "GitLab"),
    [provider],
  );

  const startOAuth = () => {
    const returnTo = `${window.location.origin}/settings/git-ssh`;
    const url = api.integrations.git.oauthStartUrl(
      provider,
      workspaceId,
      projectId,
      returnTo,
    );
    window.location.assign(url);
  };

  const submitPat = async () => {
    const token = pat.trim();
    if (!token) {
      setPatError("Paste a valid personal access token.");
      return;
    }
    setPatError(null);
    setPatSubmitting(true);
    try {
      await api.integrations.git.connectPAT(provider, workspaceId, token);
      await onConnected?.();
      onClose();
      setPat("");
      afterSessionEstablished?.();
    } catch (e) {
      setPatError(e instanceof Error ? e.message : "Could not verify token.");
    } finally {
      setPatSubmitting(false);
    }
  };

  const iconSlug = provider;

  return (
    <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl text-slate-900 animate-in zoom-in-95 duration-300">
      <div className="p-8">
        <div className="flex justify-center mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://cdn.simpleicons.org/${iconSlug}/000000`}
            className="size-14"
            alt={providerLabel}
          />
        </div>
        <h2 className="text-xl font-black text-center mb-1">
          Connect {providerLabel}
        </h2>
        <p className="text-xs text-center text-slate-500 mb-6">
          Per workspace • Choose a project before connecting • Your token is
          encrypted on the server
        </p>

        <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
          <button
            type="button"
            disabled={!oauthConfigured}
            onClick={() => setTab(TAB_OAUTH)}
            className={`cursor-pointer flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
              tab === TAB_OAUTH
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-800 disabled:opacity-40 disabled:pointer-events-none"
            }`}
          >
            OAuth
          </button>
          <button
            type="button"
            onClick={() => setTab(TAB_PAT)}
            className={`cursor-pointer flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
              tab === TAB_PAT
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Token (PAT)
          </button>
        </div>

        {tab === TAB_OAUTH && (
          <div className="space-y-4 text-center">
            {!oauthConfigured ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                OAuth is not configured for this environment. Ask an admin to
                set{" "}
                <code className="text-[11px]">
                  {provider === "github"
                    ? "GITHUB_OAUTH_CLIENT_ID / SECRET"
                    : "GITLAB_OAUTH_CLIENT_ID / SECRET"}
                </code>
                , or use a personal access token.
              </p>
            ) : (
              <p className="text-sm text-slate-500 leading-relaxed">
                You will sign in at {providerLabel} and grant read access to
                repositories. You&apos;ll return here automatically.
              </p>
            )}
            <button
              type="button"
              disabled={!oauthConfigured}
              onClick={startOAuth}
              className="cursor-pointer w-full py-3 bg-black text-white rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              Continue with {providerLabel}
            </button>
          </div>
        )}

        {tab === TAB_PAT && (
          <div className="space-y-4">
            <label className="block text-[11px] font-black uppercase tracking-widest text-slate-500">
              Personal access token
              <textarea
                value={pat}
                onChange={(e) => {
                  setPat(e.target.value);
                  setPatError(null);
                }}
                rows={4}
                placeholder={`Paste ${providerLabel} PAT…`}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-black/10"
                autoComplete="off"
              />
            </label>
            {patError && (
              <p className="text-xs text-red-600 font-semibold">{patError}</p>
            )}
            <p className="text-[11px] text-slate-500 leading-snug">
              {provider === "github" ? (
                <>
                  Required scopes typically include{" "}
                  <code className="text-[10px]">repo</code> (private repos) or{" "}
                  <code className="text-[10px]">public_repo</code> only.
                </>
              ) : (
                <>
                  Use a token with <code className="text-[10px]">read_api</code>{" "}
                  and <code className="text-[10px]">read_repository</code>.
                </>
              )}
            </p>
            <button
              type="button"
              disabled={patSubmitting}
              onClick={() => void submitPat()}
              className="cursor-pointer w-full py-3 bg-black text-white rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-60"
            >
              {patSubmitting ? "Verifying…" : "Save token"}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer w-full mt-6 py-2 text-slate-500 text-sm font-bold hover:text-slate-900 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default OAuthSimulationModal;
