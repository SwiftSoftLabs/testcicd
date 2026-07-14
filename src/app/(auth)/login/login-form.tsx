"use client";

import {
  clearManualSignOutMarker,
  performManualSignOut,
  persistClientSessionAndSync,
  resetSessionExpiredGuard,
  restoreSessionIfPossible,
} from "@/lib/auth/client-session";
import { loginWithPasskey } from "@/lib/passkeys/client";
import { insforgeNative } from "@/lib/insforge/native";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Mode = "login" | "forgot" | "reset";

export default function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const restoreAttempted = useRef(false);

  useEffect(() => {
    resetSessionExpiredGuard();
    const params = new URLSearchParams(window.location.search);
    if (params.get("reason") === "session_expired") {
      setError("Your session expired. Please sign in again.");
    }
    if (params.get("reason") === "signed_out") {
      setSuccessMsg("You have been signed out.");
    }
    if (params.get("reason") === "password_updated") {
      setSuccessMsg("Password updated. Please sign in again.");
    }
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;

    void (async () => {
      const restored = await restoreSessionIfPossible();
      if (!restored) return;
      const redirectTo =
        new URLSearchParams(window.location.search).get("redirectTo") ||
        "/dashboard";
      window.location.replace(redirectTo);
    })();
  }, []);

  const handlePasskeyLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await loginWithPasskey(email.trim() || undefined);
      await persistClientSessionAndSync(
        session.accessToken,
        session.refreshToken,
        session.user,
      );
      clearManualSignOutMarker();
      localStorage.setItem(
        "ow-current-user",
        JSON.stringify({
          id: session.user.id,
          email: session.user.email,
          name:
            session.user.profile?.name ||
            session.user.email?.split("@")[0] ||
            "User",
        }),
      );
      const redirectTo =
        new URLSearchParams(window.location.search).get("redirectTo") || "/";
      window.location.replace(redirectTo);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Passkey sign-in failed. Try password or add a passkey in Settings.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          payload?.message ||
            payload?.error ||
            "Incorrect email or password. Please try again.",
        );
        return;
      }

      if (!payload?.accessToken || !payload?.user) {
        setError("Auth session or user not found.");
        return;
      }

      const refreshToken: string =
        typeof payload.refreshToken === "string" &&
        payload.refreshToken.length > 0
          ? payload.refreshToken
          : payload.accessToken;

      // 1–2. Supabase-style storage + sb-access-token (renewed periodically via refresh)
      await persistClientSessionAndSync(
        payload.accessToken,
        refreshToken,
        payload.user,
      );

      clearManualSignOutMarker();
      // 3. AppContext fast-read
      localStorage.setItem(
        "ow-current-user",
        JSON.stringify({
          id: payload.user.id,
          email: payload.user.email,
          name:
            payload.user.profile?.name ||
            payload.user.email?.split("@")[0] ||
            "User",
        }),
      );

      // Full page reload so AppContext remounts and fetchProfile() picks up
      // the stored credentials. router.push() does a client-side nav that
      // keeps the old AppContext state (dummy user).
      const redirectTo =
        new URLSearchParams(window.location.search).get("redirectTo") ||
        "/dashboard";
      window.location.replace(redirectTo);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to login at this time. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSendResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/auth/v1/email/send-reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(
          payload?.message ||
            payload?.error ||
            "Failed to send reset code. Please try again.",
        );
        return;
      }
      setMode("reset");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send reset code.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Step 1: exchange 6-digit code for a reset token
      const exchangeRes = await fetch(
        "/auth/v1/email/exchange-reset-password-token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code: resetCode }),
        },
      );
      const exchangePayload = await exchangeRes.json().catch(() => null);
      if (!exchangeRes.ok) {
        setError(
          exchangePayload?.message ||
            exchangePayload?.error ||
            "Invalid or expired code. Please try again.",
        );
        return;
      }

      const resetToken = exchangePayload?.token ?? exchangePayload?.data?.token;
      if (!resetToken) {
        setError("Reset token missing from response. Please try again.");
        return;
      }

      // Step 2: set the new password using the token
      const resetRes = await fetch("/auth/v1/email/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, otp: resetToken }),
      });
      if (!resetRes.ok) {
        const resetPayload = await resetRes.json().catch(() => null);
        setError(
          resetPayload?.message ||
            resetPayload?.error ||
            "Failed to reset password. Please try again.",
        );
        return;
      }

      setSuccessMsg("Password updated successfully. You can now sign in.");
      setMode("login");
      setResetCode("");
      setNewPassword("");
      setPassword("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reset password.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: "github" | "google") => {
    setLoading(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const redirectTo = params.get("redirectTo") || "/dashboard";
      const callbackUrl = new URL("/auth/oauth-callback", window.location.origin);
      callbackUrl.searchParams.set("next", redirectTo);

      await insforgeNative.auth.signInWithOAuth({
        provider,
        redirectTo: callbackUrl.toString(),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "OAuth failed. Please try again.",
      );
      setLoading(false);
    }
  };

  // ── Forgot Password view ──────────────────────────────────────────────────
  if (mode === "forgot") {
    return (
      <div className="bg-surface-dark border border-border-dark p-8 rounded-3xl shadow-2xl backdrop-blur-md">
        <button
          onClick={() => {
            setMode("login");
            setError(null);
          }}
          className="cursor-pointer flex items-center gap-1 text-text-secondary text-xs mb-6 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">
            arrow_back
          </span>
          Back to Sign In
        </button>
        <h2 className="text-xl font-black text-white mb-1">Forgot Password</h2>
        <p className="text-text-secondary text-xs mb-6">
          Enter your email and we&apos;ll send you a 6-digit reset code.
        </p>
        <form onSubmit={handleSendResetCode} className="space-y-5">
          {error && (
            <div className="p-3 bg-red-500/10 border border-danger/20 rounded-xl text-danger text-xs font-bold">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-[20px]">
                mail
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-background-dark border-border-dark rounded-xl text-main text-sm focus:ring-1 focus:ring-primary focus:border-primary pl-12 pr-4 py-3.5 transition-all outline-none"
                placeholder="name@company.com"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="cursor-pointer w-full py-4 bg-primary text-white rounded-2xl font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50"
          >
            {loading ? (
              <div className="size-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              "Send Reset Code"
            )}
          </button>
        </form>
      </div>
    );
  }

  // ── Reset Code view ───────────────────────────────────────────────────────
  if (mode === "reset") {
    return (
      <div className="bg-surface-dark border border-border-dark p-8 rounded-3xl shadow-2xl backdrop-blur-md">
        <button
          onClick={() => {
            setMode("forgot");
            setError(null);
          }}
          className="cursor-pointer flex items-center gap-1 text-text-secondary text-xs mb-6 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">
            arrow_back
          </span>
          Back
        </button>
        <h2 className="text-xl font-black text-white mb-1">Set New Password</h2>
        <p className="text-text-secondary text-xs mb-6">
          Check your inbox for a 6-digit code from OneWork and enter it below.
        </p>
        <form onSubmit={handleResetPassword} className="space-y-5">
          {error && (
            <div className="p-3 bg-red-500/10 border border-danger/20 rounded-xl text-danger text-xs font-bold">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-[20px]">
                mail
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-background-dark border-border-dark rounded-xl text-main text-sm focus:ring-1 focus:ring-primary focus:border-primary pl-12 pr-4 py-3.5 transition-all outline-none"
                placeholder="name@company.com"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
              6-Digit Code
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-[20px]">
                pin
              </span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={resetCode}
                onChange={(e) =>
                  setResetCode(e.target.value.replace(/\D/g, ""))
                }
                className="w-full bg-background-dark border-border-dark rounded-xl text-main text-sm focus:ring-1 focus:ring-primary focus:border-primary pl-12 pr-4 py-3.5 transition-all outline-none tracking-[0.4em]"
                placeholder="123456"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
              New Password
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-[20px]">
                lock
              </span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-background-dark border-border-dark rounded-xl text-main text-sm focus:ring-1 focus:ring-primary focus:border-primary pl-12 pr-4 py-3.5 transition-all outline-none"
                placeholder="Choose a new password"
                minLength={6}
                required
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || resetCode.length !== 6}
            className="cursor-pointer w-full py-4 bg-primary text-white rounded-2xl font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50"
          >
            {loading ? (
              <div className="size-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              "Set New Password"
            )}
          </button>
        </form>
      </div>
    );
  }

  // ── Login view ────────────────────────────────────────────────────────────
  return (
    <div className="bg-surface-dark border border-border-dark p-8 rounded-3xl shadow-2xl backdrop-blur-md">
      <form onSubmit={handleLogin} className="space-y-6">
        {error && (
          <div className="p-3 bg-red-500/10 border border-danger/20 rounded-xl text-danger text-xs font-bold">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-xs font-bold">
            {successMsg}
          </div>
        )}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
            Email Address
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-[20px]">
              mail
            </span>
            <input
              suppressHydrationWarning
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background-dark border-border-dark rounded-xl text-main text-sm focus:ring-1 focus:ring-primary focus:border-primary pl-12 pr-4 py-3.5 transition-all outline-none"
              placeholder="name@company.com"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
              Password
            </label>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccessMsg(null);
                setMode("forgot");
              }}
              className="cursor-pointer text-[10px] font-bold text-primary hover:underline"
            >
              Forgot Password?
            </button>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-[20px]">
              lock
            </span>
            <input
              suppressHydrationWarning
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-background-dark border-border-dark rounded-xl text-main text-sm focus:ring-1 focus:ring-primary focus:border-primary pl-12 pr-4 py-3.5 transition-all outline-none"
              placeholder="Enter your password"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="cursor-pointer w-full py-4 bg-primary text-white rounded-2xl font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {loading ? (
            <div className="size-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
          ) : (
            <>
              Sign In{" "}
              <span className="material-symbols-outlined">arrow_forward</span>
            </>
          )}
        </button>
      </form>

      <div className="mt-8 pt-8 border-t border-white/5 flex flex-col gap-3">
        <p className="text-center text-[10px] text-text-secondary/50 uppercase tracking-widest font-bold mb-1">
          Or continue with
        </p>
        <button
          type="button"
          onClick={() => void handlePasskeyLogin()}
          disabled={loading}
          className="cursor-pointer w-full py-3 bg-white/5 border border-border-dark text-main text-xs font-bold rounded-xl flex items-center justify-center gap-3 hover:bg-white/10 transition-all disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[20px]">passkey</span>
          Sign in with passkey
        </button>
        <button
          type="button"
          onClick={() => handleOAuthLogin("github")}
          disabled={loading}
          className="cursor-pointer w-full py-3 bg-white/5 border border-border-dark text-main text-xs font-bold rounded-xl flex items-center justify-center gap-3 hover:bg-white/10 transition-all disabled:opacity-50"
        >
          <img
            src="https://cdn.simpleicons.org/github/ffffff"
            className="size-5"
            alt=""
          />
          Continue with GitHub
        </button>
        <button
          type="button"
          onClick={() => handleOAuthLogin("google")}
          disabled={loading}
          className="cursor-pointer w-full py-3 bg-white/5 border border-border-dark text-main text-xs font-bold rounded-xl flex items-center justify-center gap-3 hover:bg-white/10 transition-all disabled:opacity-50"
        >
          <img
            src="https://cdn.simpleicons.org/google/ffffff"
            className="size-5"
            alt=""
          />
          Continue with Google
        </button>
      </div>

      <p className="text-center mt-10 text-text-secondary text-xs">
        Need an account?{" "}
        <button
          onClick={() => router.push("/signup")}
          className="cursor-pointer text-primary font-bold hover:underline"
        >
          Sign Up
        </button>
      </p>
    </div>
  );
}
