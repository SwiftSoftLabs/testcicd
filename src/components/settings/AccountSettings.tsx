"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { useUIContext } from "@/context/UIContext";
import { api } from "@/lib/api";
import { useAppContext } from "@/context/AppContext";
import { insforgeNative } from "@/lib/insforge/native";
import { performManualSignOut } from "@/lib/auth/client-session";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
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

type ProfileSectionProps = {
  formData: { name: string; role: string; email: string; avatar: string };
  isSavingProfile: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAvatarClick: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFormChange: (field: "name" | "role", value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
};

type SecuritySectionProps = {
  sessions: SessionItem[];
  isSigningOutOthers: boolean;
  resetCode: string;
  newPassword: string;
  confirmPassword: string;
  isResetCodeSent: boolean;
  isSendingResetCode: boolean;
  isUpdatingPassword: boolean;
  passwordChecks: { label: string; met: boolean }[];
  isPasswordFormValid: boolean;
  onRevokeSession: (id: string) => void;
  onSignOutAll: () => void;
  onResetCodeChange: (v: string) => void;
  onNewPasswordChange: (v: string) => void;
  onConfirmPasswordChange: (v: string) => void;
  onSendResetCode: () => void;
  onUpdatePassword: (e: React.FormEvent) => void;
};

function ProfileSection({
  formData,
  isSavingProfile,
  fileInputRef,
  onAvatarClick,
  onFileChange,
  onFormChange,
  onSave,
  onDiscard,
}: ProfileSectionProps) {
  return (
    <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm theme-transition">
      <h3 className="text-lg font-bold text-white mb-6">Account Information</h3>
      <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
        <div className="relative group shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="size-32 rounded-2xl border-4 border-border-dark object-cover group-hover:opacity-75 transition-all cursor-pointer"
            src={
              formData.avatar ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.name || "User")}&background=195de6&color=fff&size=128`
            }
            alt={`${formData.name || "User"} profile photo`}
            onClick={onAvatarClick}
          />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all pointer-events-none">
            <span className="material-symbols-outlined text-white text-3xl">
              photo_camera
            </span>
          </div>
          <button
            onClick={onAvatarClick}
            className="cursor-pointer absolute -bottom-2 -right-2 size-8 rounded-full bg-primary text-white border-4 border-surface-dark flex items-center justify-center shadow-lg hover:bg-blue-600 transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={onFileChange}
          />
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Full Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onFormChange("name", e.target.value)}
              className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Job Title
            </label>
            <input
              type="text"
              value={formData.role}
              onChange={(e) => onFormChange("role", e.target.value)}
              className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Email Address
            </label>
            <input
              type="email"
              value={formData.email}
              disabled
              readOnly
              className="w-full bg-background-dark/70 border-border-dark rounded-xl text-text-secondary text-sm px-4 py-2.5 transition-all outline-none cursor-not-allowed"
            />
            <p className="text-[11px] text-text-secondary">
              Email is managed by account authentication settings.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-white/5">
        <button
          onClick={onDiscard}
          className="cursor-pointer px-6 py-2.5 rounded-xl text-text-secondary text-sm font-bold hover:text-white transition-colors"
        >
          Discard
        </button>
        <button
          onClick={onSave}
          disabled={isSavingProfile}
          className="px-6 py-2.5 bg-primary text-white text-sm font-black rounded-xl shadow-lg shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {isSavingProfile ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </section>
  );
}

function SecuritySection({
  sessions,
  isSigningOutOthers,
  resetCode,
  newPassword,
  confirmPassword,
  isResetCodeSent,
  isSendingResetCode,
  isUpdatingPassword,
  passwordChecks,
  isPasswordFormValid,
  onRevokeSession,
  onSignOutAll,
  onResetCodeChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSendResetCode,
  onUpdatePassword,
}: SecuritySectionProps) {
  return (
    <>
      <TwoFactorSettingsCard variant="account" />
      <PasskeysSettingsCard />

      <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm theme-transition">
        <h3 className="text-lg font-bold text-white mb-6 border-b border-white/5 pb-4">
          Change Password
        </h3>
        <form onSubmit={onUpdatePassword} className="space-y-6">
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
                value={resetCode}
                onChange={(e) => onResetCodeChange(e.target.value)}
                placeholder="Enter reset code sent to email"
                className="w-full bg-background-dark border-border-dark rounded-xl pl-12 pr-4 py-3 text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none"
              />
            </div>
            <div className="flex justify-between items-center">
              <p className="text-xs text-text-secondary">
                {isResetCodeSent
                  ? "Code sent. Check your inbox."
                  : "Send a code before updating your password."}
              </p>
              <button
                type="button"
                onClick={onSendResetCode}
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
                  value={newPassword}
                  onChange={(e) => onNewPasswordChange(e.target.value)}
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
                  value={confirmPassword}
                  onChange={(e) => onConfirmPasswordChange(e.target.value)}
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
                    className={`size-1 rounded-full ${req.met ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-white/20"}`}
                  ></span>
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

      <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm theme-transition">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white">Active Sessions</h3>
          {sessions.length > 1 && (
            <button
              onClick={onSignOutAll}
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
              className="bg-background-dark/30 border border-border-dark rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 group hover:border-white/10 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="size-11 sm:size-12 bg-surface-highlight rounded-xl flex items-center justify-center text-text-secondary group-hover:text-white transition-colors shrink-0">
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
                <span className="text-xs font-bold text-emerald-500 sm:ml-auto">
                  Active now
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRevokeSession(session.id)}
                  className="cursor-pointer self-start sm:self-auto text-[10px] font-black text-text-secondary uppercase tracking-widest hover:text-red-400 transition-colors bg-white/5 px-3 py-1.5 rounded-lg border border-transparent hover:border-red-400/30"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-surface-dark border border-red-500/20 rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm theme-transition">
        <h3 className="text-lg font-bold text-red-400 mb-2">Danger Zone</h3>
        <p className="text-sm text-text-secondary mb-6">
          Irreversible actions that affect your account permanently.
        </p>
        <div className="flex flex-col gap-4 p-5 bg-background-dark/30 border border-border-dark rounded-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">Delete Account</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Permanently delete your account and all associated data.
            </p>
          </div>
          <button
            disabled
            className="shrink-0 self-start px-5 py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold rounded-xl opacity-60 cursor-not-allowed sm:self-auto"
            title="Contact support to delete your account"
          >
            Contact Support
          </button>
        </div>
      </section>
    </>
  );
}

const AccountSettings = () => {
  const { currentUser, updateCurrentUser } = useAppContext();
  const { addToast } = useUIContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: currentUser.name,
    role: currentUser.role,
    email: currentUser.email,
    avatar: currentUser.avatar,
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

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
  const [isSigningOutOthers, setIsSigningOutOthers] = useState(false);

  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResetCodeSent, setIsResetCodeSent] = useState(false);
  const [isSendingResetCode, setIsSendingResetCode] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    setFormData({
      name: currentUser.name,
      role: currentUser.role,
      email: currentUser.email,
      avatar: currentUser.avatar,
    });
  }, [currentUser]);

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      addToast("Avatar must be 2 MB or smaller.", "warning");
      return;
    }

    // Optimistic local preview while the file uploads to storage.
    const previewUrl = URL.createObjectURL(file);
    setFormData((prev) => ({ ...prev, avatar: previewUrl }));
    setIsSavingProfile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authenticatedFetch("/api/profile/avatar", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      const { url } = (await res.json()) as { url: string };
      setFormData((prev) => ({ ...prev, avatar: url }));
      addToast("Avatar uploaded. Save to apply.", "info");
    } catch (err) {
      setFormData((prev) => ({ ...prev, avatar: currentUser.avatar }));
      addToast(err instanceof Error ? err.message : "Avatar upload failed.", "error");
    } finally {
      URL.revokeObjectURL(previewUrl);
      setIsSavingProfile(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!formData.name.trim()) {
      addToast("Full name is required.", "warning");
      return;
    }
    const payload: Record<string, unknown> = {};
    if (formData.name.trim() !== (currentUser.name || "").trim())
      payload.full_name = formData.name.trim();
    if ((formData.role || "").trim() !== (currentUser.role || "").trim())
      payload.role = formData.role.trim();
    if (formData.avatar !== currentUser.avatar)
      payload.avatar_url = formData.avatar;

    if (Object.keys(payload).length === 0) {
      addToast("No changes to save.", "info");
      return;
    }
    setIsSavingProfile(true);
    try {
      const response = (await api.profile.updateMe(payload)) as {
        data?: {
          full_name?: string;
          role?: string;
          avatar_url?: string;
          email?: string;
        };
      };
      const profile = response?.data;
      updateCurrentUser({
        name: profile?.full_name || formData.name,
        role: profile?.role || formData.role,
        avatar: profile?.avatar_url || formData.avatar,
      });
      addToast("Profile updated successfully!", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update profile";
      addToast(message, "error");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleDiscardProfile = () => {
    setFormData({
      name: currentUser.name,
      role: currentUser.role,
      email: currentUser.email,
      avatar: currentUser.avatar,
    });
    addToast("Changes discarded.", "info");
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
    const meetsRequirements = passwordChecks.every((r) => r.met);
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
        redirectTo: `${window.location.origin}/settings/account`,
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
    if (newPassword !== confirmPassword) {
      addToast("Passwords do not match.", "error");
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
      if (resetError)
        throw new Error(resetError.message || "Failed to update password");

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

  return (
    <div className="min-w-0 max-w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <ProfileSection
        formData={formData}
        isSavingProfile={isSavingProfile}
        fileInputRef={fileInputRef}
        onAvatarClick={handleAvatarClick}
        onFileChange={handleFileChange}
        onFormChange={(field, value) =>
          setFormData((prev) => ({ ...prev, [field]: value }))
        }
        onSave={handleSaveProfile}
        onDiscard={handleDiscardProfile}
      />

      <div className="flex items-center gap-4 pt-2">
        <span className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
          Security
        </span>
        <div className="flex-1 h-px bg-border-dark/60" />
      </div>

      <SecuritySection
        sessions={sessions}
        isSigningOutOthers={isSigningOutOthers}
        resetCode={resetCode}
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        isResetCodeSent={isResetCodeSent}
        isSendingResetCode={isSendingResetCode}
        isUpdatingPassword={isUpdatingPassword}
        passwordChecks={passwordChecks}
        isPasswordFormValid={isPasswordFormValid}
        onRevokeSession={handleRevokeSession}
        onSignOutAll={handleSignOutAll}
        onResetCodeChange={setResetCode}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onSendResetCode={handleSendResetCode}
        onUpdatePassword={handleUpdatePassword}
      />
    </div>
  );
};

export default AccountSettings;
