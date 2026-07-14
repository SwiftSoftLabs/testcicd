"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useUIContext } from "@/context/UIContext";
import { api } from "@/lib/api";

type MfaStatus = {
  twoFactorEnabled: boolean;
  hasPendingSetup?: boolean;
  backupCodesRemaining?: number;
};

type SetupState = {
  qrDataUrl: string;
  secret: string;
  manualEntryKey: string;
};

export default function TwoFactorSettingsCard({
  variant = "security",
}: {
  variant?: "security" | "account";
}) {
  const { addToast } = useUIContext();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showSetup, setShowSetup] = useState(false);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await api.security.twoFactor.status()) as MfaStatus;
      setStatus(res);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load 2FA status";
      addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleStartSetup = async () => {
    setBusy(true);
    try {
      const data = (await api.security.twoFactor.setup()) as SetupState;
      setSetup(data);
      setConfirmCode("");
      setBackupCodes(null);
      setShowSetup(true);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to start 2FA setup";
      addToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSetup = async () => {
    if (!confirmCode.trim()) return;
    setBusy(true);
    try {
      const res = (await api.security.twoFactor.confirm(confirmCode.trim())) as {
        backupCodes: string[];
      };
      setBackupCodes(res.backupCodes);
      setStatus({ twoFactorEnabled: true, backupCodesRemaining: res.backupCodes.length });
      addToast("Authenticator app linked successfully.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Invalid verification code";
      addToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!disableCode.trim()) return;
    setBusy(true);
    try {
      await api.security.twoFactor.disable(disableCode.trim());
      setShowDisable(false);
      setDisableCode("");
      await loadStatus();
      addToast("Two-factor authentication disabled.", "warning");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to disable 2FA";
      addToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const enabled = status?.twoFactorEnabled ?? false;
  const titleClass = variant === "account" ? "text-lg" : "text-xl";

  return (
    <>
      <section
        className={`bg-surface-dark border rounded-2xl p-8 flex items-center justify-between transition-all ${enabled ? "border-primary/50 ring-1 ring-primary/20" : "border-border-dark"}`}
      >
        <div className="flex items-start gap-6">
          <div
            className={`size-12 rounded-xl flex items-center justify-center shadow-inner shrink-0 mt-1 transition-colors ${enabled ? "bg-primary/20 text-primary" : "bg-surface-highlight text-text-secondary"}`}
          >
            <span
              className="material-symbols-outlined text-3xl"
              style={{
                fontVariationSettings: enabled ? "'FILL' 1" : "'FILL' 0",
              }}
            >
              {enabled ? "verified_user" : "security"}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className={`${titleClass} font-bold text-white`}>
                Two-Factor Authentication
              </h3>
              {enabled && (
                <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-black uppercase tracking-widest border border-emerald-500/20">
                  Active
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary max-w-md">
              Use an authenticator app (Google Authenticator, 1Password, Authy,
              etc.) for TOTP codes. Vault access requires a fresh code when 2FA
              is on.
            </p>
            {enabled && status?.backupCodesRemaining !== undefined && (
              <p className="text-xs text-text-muted mt-2">
                {status.backupCodesRemaining} backup code
                {status.backupCodesRemaining === 1 ? "" : "s"} remaining
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            enabled ? setShowDisable(true) : void handleStartSetup()
          }
          disabled={busy || loading}
          className={`px-6 py-2 border text-sm font-bold rounded-lg transition-all shrink-0 ${enabled ? "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20" : "bg-surface-highlight border-border-dark text-white hover:bg-white/10"}`}
        >
          {busy ? "Please wait..." : enabled ? "Disable 2FA" : "Set up 2FA"}
        </button>
      </section>

      {showSetup && setup && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70">
          <div className="bg-surface-dark border border-border-dark rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-6">
            <h3 className="text-xl font-bold text-white">Set up authenticator</h3>
            {backupCodes ? (
              <div className="space-y-4">
                <p className="text-sm text-text-secondary">
                  Save these backup codes somewhere safe. Each can be used once
                  if you lose your authenticator.
                </p>
                <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-white bg-background-dark rounded-xl p-4 border border-border-dark">
                  {backupCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    setShowSetup(false);
                    setSetup(null);
                    setBackupCodes(null);
                  }}
                  className="w-full py-3 bg-primary text-white font-bold rounded-xl"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-text-secondary">
                  Scan the QR code with your authenticator app, then enter the
                  6-digit code.
                </p>
                <div className="flex justify-center bg-white rounded-xl p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={setup.qrDataUrl} alt="TOTP QR code" width={220} height={220} />
                </div>
                <p className="text-xs text-text-muted break-all text-center font-mono">
                  Manual key: {setup.manualEntryKey}
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full bg-background-dark border-border-dark rounded-xl px-4 py-3 text-white text-center text-2xl tracking-[0.4em] font-mono"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSetup(false);
                      setSetup(null);
                    }}
                    className="flex-1 py-3 border border-border-dark rounded-xl text-text-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy || confirmCode.length !== 6}
                    onClick={() => void handleConfirmSetup()}
                    className="flex-1 py-3 bg-primary text-white font-bold rounded-xl disabled:opacity-50"
                  >
                    Verify
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showDisable && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70">
          <div className="bg-surface-dark border border-border-dark rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-6">
            <h3 className="text-xl font-bold text-white">Disable 2FA</h3>
            <p className="text-sm text-text-secondary">
              Enter a code from your authenticator app or a backup code.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder="6-digit or backup code"
              className="w-full bg-background-dark border-border-dark rounded-xl px-4 py-3 text-white"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDisable(false);
                  setDisableCode("");
                }}
                className="flex-1 py-3 border border-border-dark rounded-xl text-text-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !disableCode.trim()}
                onClick={() => void handleDisable()}
                className="flex-1 py-3 bg-red-500/20 text-red-400 border border-red-500/30 font-bold rounded-xl disabled:opacity-50"
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
