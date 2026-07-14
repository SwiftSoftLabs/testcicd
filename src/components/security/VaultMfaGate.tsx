"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useUIContext } from "@/context/UIContext";
import { api } from "@/lib/api";
import {
  authenticatePasskeyForStepUp,
  registerPasskey,
} from "@/lib/passkeys/client";

type MfaGateStatus = {
  twoFactorEnabled: boolean;
  totpEnabled?: boolean;
  passkeyCount?: number;
  vaultStepUpVerified: boolean;
};

type SetupState = {
  qrDataUrl: string;
  secret: string;
  manualEntryKey: string;
};

export default function VaultMfaGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { addToast } = useUIContext();
  const [status, setStatus] = useState<MfaGateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const mountedRef = useRef(true);

  // Inline 2FA enrollment state (when the user has no MFA method yet)
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const clearVaultStepUp = useCallback(async () => {
    try {
      await api.security.twoFactor.clearVaultStepUp();
    } catch {
      // Non-blocking when tearing down
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await api.security.twoFactor.status()) as MfaGateStatus;
      if (mountedRef.current) setStatus(res);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to check 2FA status";
      addToast(message, "error");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    mountedRef.current = true;
    const init = async () => {
      await clearVaultStepUp();
      await loadStatus();
    };
    void init();

    return () => {
      mountedRef.current = false;
      void clearVaultStepUp();
    };
  }, [clearVaultStepUp, loadStatus]);

  const handleVerifyTotp = async () => {
    if (code.trim().length < 6) return;
    setVerifying(true);
    try {
      await api.security.twoFactor.verify(code.trim());
      setCode("");
      await loadStatus();
      addToast("Vault unlocked.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Invalid verification code";
      addToast(message, "error");
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyPasskey = async () => {
    setVerifying(true);
    try {
      await authenticatePasskeyForStepUp();
      await loadStatus();
      addToast("Vault unlocked.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Passkey verification failed";
      addToast(message, "error");
    } finally {
      setVerifying(false);
    }
  };

  const handleStartSetup = async () => {
    setSetupBusy(true);
    try {
      const data = (await api.security.twoFactor.setup()) as SetupState;
      if (!mountedRef.current) return;
      setSetup(data);
      setConfirmCode("");
      setBackupCodes(null);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to start 2FA setup";
      addToast(message, "error");
    } finally {
      if (mountedRef.current) setSetupBusy(false);
    }
  };

  const handleConfirmSetup = async () => {
    if (confirmCode.length !== 6) return;
    setSetupBusy(true);
    try {
      const res = (await api.security.twoFactor.confirm(confirmCode)) as {
        backupCodes: string[];
      };
      if (!mountedRef.current) return;
      setBackupCodes(res.backupCodes);
      addToast("Two-factor authentication enabled.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Invalid verification code";
      addToast(message, "error");
    } finally {
      if (mountedRef.current) setSetupBusy(false);
    }
  };

  const handleEnrollPasskey = async () => {
    setSetupBusy(true);
    try {
      const name =
        typeof navigator !== "undefined"
          ? `${navigator.platform} passkey`
          : "Passkey";
      await registerPasskey(name);
      addToast("Passkey added. Two-factor authentication enabled.", "success");
      // Registration granted the step-up cookie, so this unlocks the vault.
      await loadStatus();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to register passkey";
      addToast(message, "error");
    } finally {
      if (mountedRef.current) setSetupBusy(false);
    }
  };

  const handleFinishSetup = async () => {
    setSetup(null);
    setBackupCodes(null);
    setConfirmCode("");
    // Confirm endpoint granted the step-up cookie, so this unlocks the vault.
    await loadStatus();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="material-symbols-outlined animate-spin text-text-muted text-3xl">
          progress_activity
        </span>
      </div>
    );
  }

  // Vault requires 2FA: force enrollment before showing any vault content.
  if (status && !status.twoFactorEnabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[24rem] p-6">
        <div className="bg-surface-dark border border-border-dark rounded-2xl p-8 max-w-md w-full shadow-xl space-y-6 text-center">
          {backupCodes ? (
            <>
              <span className="material-symbols-outlined text-5xl text-primary">
                key
              </span>
              <div>
                <h2 className="text-xl font-bold text-white mb-2">
                  Save your backup codes
                </h2>
                <p className="text-sm text-text-secondary">
                  Store these somewhere safe. Each code can be used once if you
                  lose access to your authenticator app.
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-white bg-background-dark rounded-xl p-4 border border-border-dark text-left">
                {backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void handleFinishSetup()}
                className="w-full py-3 bg-primary text-white font-bold rounded-xl"
              >
                Continue to Vault
              </button>
            </>
          ) : setup ? (
            <>
              <span className="material-symbols-outlined text-5xl text-primary">
                qr_code_2
              </span>
              <div>
                <h2 className="text-xl font-bold text-white mb-2">
                  Set up authenticator
                </h2>
                <p className="text-sm text-text-secondary">
                  Scan the QR code with your authenticator app (Google
                  Authenticator, 1Password, Authy, etc.), then enter the
                  6-digit code.
                </p>
              </div>
              <div className="flex justify-center bg-white rounded-xl p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={setup.qrDataUrl}
                  alt="TOTP QR code"
                  width={220}
                  height={220}
                />
              </div>
              <p className="text-xs text-text-muted break-all text-center font-mono">
                Manual key: {setup.manualEntryKey}
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={confirmCode}
                onChange={(e) =>
                  setConfirmCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleConfirmSetup();
                }}
                placeholder="000000"
                className="w-full bg-background-dark border-border-dark rounded-xl px-4 py-3 text-white text-center text-2xl tracking-[0.4em] font-mono"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSetup(null);
                    setConfirmCode("");
                  }}
                  className="flex-1 py-3 border border-border-dark rounded-xl text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={setupBusy || confirmCode.length !== 6}
                  onClick={() => void handleConfirmSetup()}
                  className="flex-1 py-3 bg-primary text-white font-bold rounded-xl disabled:opacity-50"
                >
                  {setupBusy ? "Verifying..." : "Verify & enable"}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-5xl text-primary">
                shield_lock
              </span>
              <div>
                <h2 className="text-xl font-bold text-white mb-2">
                  Two-factor authentication required
                </h2>
                <p className="text-sm text-text-secondary">
                  The Vault stores sensitive secrets, so two-factor
                  authentication is required to access it. Choose a method to
                  continue.
                </p>
              </div>
              <button
                type="button"
                disabled={setupBusy}
                onClick={() => void handleEnrollPasskey()}
                className="w-full py-3 bg-primary text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-xl">
                  passkey
                </span>
                {setupBusy ? "Working..." : "Use a passkey"}
              </button>
              <p className="text-xs text-text-secondary -mt-2">
                Face ID, Touch ID, Windows Hello, or a security key.
              </p>
              <p className="text-xs text-text-muted uppercase tracking-widest">
                or
              </p>
              <button
                type="button"
                disabled={setupBusy}
                onClick={() => void handleStartSetup()}
                className="w-full py-3 bg-surface-highlight border border-border-dark text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-xl">
                  qr_code_2
                </span>
                {setupBusy ? "Preparing..." : "Set up authenticator app"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (status?.twoFactorEnabled && !status.vaultStepUpVerified) {
    const hasPasskeys = (status.passkeyCount ?? 0) > 0;
    const hasTotp = status.totpEnabled ?? true;

    return (
      <div className="flex flex-col items-center justify-center min-h-[24rem] p-6">
        <div className="bg-surface-dark border border-border-dark rounded-2xl p-8 max-w-md w-full shadow-xl space-y-6 text-center">
          <span className="material-symbols-outlined text-5xl text-primary">
            lock
          </span>
          <div>
            <h2 className="text-xl font-bold text-white mb-2">
              Verify two-factor authentication
            </h2>
            <p className="text-sm text-text-secondary">
              Verify to access the Vault. You will need to verify again each time
              you open this page.
            </p>
          </div>

          {hasPasskeys && (
            <button
              type="button"
              disabled={verifying}
              onClick={() => void handleVerifyPasskey()}
              className="w-full py-3 bg-primary text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-xl">passkey</span>
              {verifying ? "Verifying..." : "Use passkey"}
            </button>
          )}

          {hasPasskeys && hasTotp && (
            <p className="text-xs text-text-muted uppercase tracking-widest">
              or
            </p>
          )}

          {hasTotp && (
            <>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleVerifyTotp();
                }}
                placeholder="000000"
                className="w-full bg-background-dark border-border-dark rounded-xl px-4 py-3 text-white text-center text-2xl tracking-[0.35em] font-mono"
              />
              <button
                type="button"
                disabled={verifying || code.length < 6}
                onClick={() => void handleVerifyTotp()}
                className="w-full py-3 bg-surface-highlight border border-border-dark text-white font-bold rounded-xl disabled:opacity-50"
              >
                {verifying ? "Verifying..." : "Unlock with code"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
