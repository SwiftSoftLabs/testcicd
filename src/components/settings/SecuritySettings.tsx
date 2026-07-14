"use client";

import React, { useMemo, useState } from "react";
import { useUIContext } from "@/context/UIContext";
import { performManualSignOut } from "@/lib/auth/client-session";
import { api } from "@/lib/api";
import { insforgeNative } from "@/lib/insforge/native";
import { useAppContext } from "@/context/AppContext";
import TwoFactorSettingsCard from "@/components/security/TwoFactorSettingsCard";
import PasskeysSettingsCard from "@/components/security/PasskeysSettingsCard";

type SessionItem = {
  id: string;
  device: string;
  location: string;
  browser: string;
  ip: string;
  current: boolean;
};

const SecuritySettings: React.FC = () => {
  const { currentUser } = useAppContext();
  const { addToast } = useUIContext();
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResetCodeSent, setIsResetCodeSent] = useState(false);

  const [sessions, setSessions] = useState<SessionItem[]>([
    {
      id: "current",
      device: "Current Device",
      location: "Current session",
      browser: "Web",
      ip: "-",
      current: true,
    },
  ]);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isSendingResetCode, setIsSendingResetCode] = useState(false);
  const [isSigningOutOthers, setIsSigningOutOthers] = useState(false);

  const passwordChecks = useMemo(
    () => [
      { label: "Minimum 8 characters long", met: newPassword.length >= 8 },
      {
        label: "At least one uppercase letter",
        met: /[A-Z]/.test(newPassword),
      },
      {
        label: "At least one number or symbol",
        met: /[0-9!@#$%^&*]/.test(newPassword),
      },
    ],
    [newPassword],
  );

  const isPasswordFormValid = useMemo(() => {
    const meetsRequirements = passwordChecks.every((req) => req.met);
    return (
      Boolean(resetCode.trim()) &&
      Boolean(newPassword) &&
      Boolean(confirmPassword) &&
      meetsRequirements &&
      newPassword === confirmPassword
    );
  }, [resetCode, newPassword, confirmPassword, passwordChecks]);

  const handleSendResetCode = async () => {
    if (!currentUser.email) {
      addToast("Current user email not available.", "error");
      return;
    }
    setIsSendingResetCode(true);
    try {
      const { error } = await insforgeNative.auth.sendResetPasswordEmail({
        email: currentUser.email,
        redirectTo: `${window.location.origin}/settings/security`,
      });
      if (error) throw new Error(error.message || "Failed to send reset code");
      setIsResetCodeSent(true);
      addToast("Password reset code sent to your email.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to send reset code";
      addToast(message, "error");
    } finally {
      setIsSendingResetCode(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      addToast("New password must be at least 8 characters.", "warning");
      return;
    }
    if (newPassword !== confirmPassword) {
      addToast("New passwords do not match.", "error");
      return;
    }
    if (!resetCode.trim()) {
      addToast("Please enter the reset code sent to your email.", "warning");
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { data: exchangeData, error: exchangeError } =
        await insforgeNative.auth.exchangeResetPasswordToken({
          email: currentUser.email,
          code: resetCode.trim(),
        });
      if (exchangeError || !exchangeData?.token) {
        throw new Error(
          exchangeError?.message || "Invalid or expired reset code",
        );
      }

      const { error: resetError } = await insforgeNative.auth.resetPassword({
        newPassword,
        otp: exchangeData.token,
      });
      if (resetError) {
        throw new Error(resetError.message || "Failed to update password");
      }

      addToast("Password updated. Please sign in again.", "success");
      await performManualSignOut({ redirectTo: "/login?reason=password_updated" });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update password";
      addToast(message, "error");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleRevokeSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    addToast("Session successfully revoked.", "info");
  };

  const handleSignOutAll = async () => {
    setIsSigningOutOthers(true);
    try {
      await api.security.signOutOtherSessions();
      setSessions((prev) => prev.filter((s) => s.current));
      addToast("Logged out of all other sessions successfully.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to sign out other sessions";
      addToast(message, "error");
    } finally {
      setIsSigningOutOthers(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <TwoFactorSettingsCard />
      <PasskeysSettingsCard />

      <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-8 border-b border-white/5 pb-4">
          Change Password
        </h3>
        <form onSubmit={handleUpdatePassword} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Reset Code
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary">
                password
              </span>
              <input
                type="text"
                required
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="Enter reset code sent to email"
                className="w-full bg-background-dark border-border-dark rounded-xl pl-12 pr-4 py-3 text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none"
              />
            </div>
            <div className="flex justify-between items-center">
              <p className="text-xs text-text-secondary">
                {isResetCodeSent
                  ? "Code sent. Check your inbox."
                  : "Send a code before updating password."}
              </p>
              <button
                type="button"
                onClick={handleSendResetCode}
                disabled={isSendingResetCode}
                className="text-xs font-bold text-primary hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSendingResetCode ? "Sending..." : "Send Code"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                New Password
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary">
                  vpn_key
                </span>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full bg-background-dark border-border-dark rounded-xl pl-12 pr-4 py-3 text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                Confirm New Password
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary">
                  check_circle
                </span>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full bg-background-dark border-border-dark rounded-xl pl-12 pr-4 py-3 text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none"
                />
              </div>
            </div>
          </div>

          <div className="bg-background-dark/30 border border-border-dark rounded-2xl p-6">
            <h4 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-4">
              Password Requirements
            </h4>
            <ul className="space-y-2">
              {passwordChecks.map((req) => (
                <li
                  key={req.label}
                  className={`flex items-center gap-2 text-xs transition-colors ${req.met ? "text-emerald-400" : "text-text-secondary"}`}
                >
                  <span
                    className={`size-1 rounded-full ${req.met ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-primary"}`}
                  ></span>{" "}
                  {req.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={isUpdatingPassword || !isPasswordFormValid}
              className="px-8 py-3 bg-primary text-white text-sm font-black rounded-xl shadow-lg shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isUpdatingPassword ? "Updating..." : "Update Password"}
            </button>
          </div>
        </form>
      </section>

      <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-lg font-bold text-white">Active Sessions</h3>
          {sessions.length > 1 && (
            <button
              onClick={handleSignOutAll}
              disabled={isSigningOutOthers}
              className="text-xs font-bold text-text-secondary hover:text-white transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              {isSigningOutOthers
                ? "Signing out..."
                : "Sign out all other devices"}
            </button>
          )}
        </div>
        <div className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="bg-background-dark/30 border border-border-dark rounded-xl p-5 flex items-center justify-between group hover:border-white/10 transition-all"
            >
              <div className="flex items-center gap-5">
                <div className="size-12 bg-surface-highlight rounded-xl flex items-center justify-center text-text-secondary group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-2xl">
                    {session.device.includes("iPhone")
                      ? "smartphone"
                      : session.device.includes("iPad")
                        ? "tablet_mac"
                        : "laptop_mac"}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-white">
                      {session.device}
                    </span>
                    {session.current && (
                      <span className="bg-emerald-500/20 text-emerald-500 text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest border border-emerald-500/20">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                    <span>{session.location}</span>
                    <span className="size-1 rounded-full bg-border-dark"></span>
                    <span>{session.browser}</span>
                    <span className="size-1 rounded-full bg-border-dark"></span>
                    <span>IP: {session.ip}</span>
                  </div>
                </div>
              </div>
              {session.current ? (
                <span className="text-xs font-bold text-emerald-500">
                  Active now
                </span>
              ) : (
                <button
                  onClick={() => handleRevokeSession(session.id)}
                  className="cursor-pointer text-[10px] font-black text-text-secondary uppercase tracking-widest hover:text-red-400 transition-colors bg-white/5 px-3 py-1.5 rounded-lg border border-transparent hover:border-red-400/30"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default SecuritySettings;
