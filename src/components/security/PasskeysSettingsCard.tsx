"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useUIContext } from "@/context/UIContext";
import { api } from "@/lib/api";
import { registerPasskey } from "@/lib/passkeys/client";

type PasskeyItem = {
  id: string;
  friendlyName: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export default function PasskeysSettingsCard() {
  const { addToast } = useUIContext();
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await api.security.passkeys.list()) as {
        passkeys: PasskeyItem[];
      };
      setPasskeys(res.passkeys ?? []);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load passkeys";
      addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    setBusy(true);
    try {
      const name =
        typeof navigator !== "undefined"
          ? `${navigator.platform} passkey`
          : "Passkey";
      await registerPasskey(name);
      addToast("Passkey added successfully.", "success");
      await load();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to register passkey";
      addToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      await api.security.passkeys.remove(id);
      addToast("Passkey removed.", "warning");
      await load();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to remove passkey";
      addToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface-dark border border-border-dark rounded-2xl p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-xl bg-surface-highlight flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-3xl text-primary">
              passkey
            </span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Passkeys</h3>
            <p className="text-sm text-text-secondary max-w-md mt-1">
              Sign in or unlock Vault with Face ID, Touch ID, Windows Hello, or
              another device passkey (including Apple iCloud Keychain).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={busy || loading}
          className="px-5 py-2 bg-surface-highlight border border-border-dark text-white text-sm font-bold rounded-lg hover:bg-white/10 disabled:opacity-50 shrink-0"
        >
          {busy ? "Working..." : "Add passkey"}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Loading passkeys...</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-text-muted">No passkeys registered yet.</p>
      ) : (
        <ul className="divide-y divide-border-dark/60 rounded-xl border border-border-dark overflow-hidden">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-4 px-4 py-3 bg-background-dark/40"
            >
              <div>
                <p className="text-sm font-semibold text-white">
                  {p.friendlyName || "Passkey"}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {p.deviceType === "singleDevice" ? "This device" : "Multi-device"}
                  {p.backedUp ? " · synced" : ""}
                  {p.lastUsedAt
                    ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRemove(p.id)}
                className="text-xs font-bold text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
