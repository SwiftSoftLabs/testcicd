"use client";

import { insforgeNative } from "@/lib/insforge/native";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!code.trim()) {
      setError("Please enter the verification code.");
      setLoading(false);
      return;
    }

    try {
      const { data, error: verifyError } =
        await insforgeNative.auth.verifyEmail({
          email,
          otp: code.trim(),
        });

      if (verifyError) {
        setError(
          verifyError.message ||
            "Invalid or expired verification code. Please try again.",
        );
        setLoading(false);
        return;
      }

      // If InsForge returns a session after verification, sync the cookie
      const dataRecord = data as {
        session?: { access_token?: string };
        accessToken?: string;
      } | null;
      const accessToken =
        dataRecord?.session?.access_token || dataRecord?.accessToken;
      if (accessToken) {
        await fetch("/api/auth/sync-cookie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        }).catch(() => {});
      }

      setMessage("Email verified! Redirecting...");
      setTimeout(() => {
        router.refresh();
        router.push("/");
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Verification failed. Please try again.",
      );
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { error: resendError } =
        await insforgeNative.auth.resendVerificationEmail({ email });

      if (resendError) {
        setError(resendError.message || "Failed to resend code.");
      } else {
        setMessage("Verification code sent to your email.");
      }
    } catch {
      setError("Failed to resend code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0d1117] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] size-[600px] bg-primary/10 rounded-full blur-[120px]"></div>
        <div className="absolute -bottom-[10%] -right-[10%] size-[600px] bg-emerald-500/10 rounded-full blur-[120px]"></div>
      </div>

      <div className="w-full max-w-md z-10">
        <div className="text-center mb-10">
          <div className="inline-flex size-16 bg-primary/10 rounded-2xl items-center justify-center mb-6">
            <span className="material-symbols-outlined text-primary text-4xl">
              mark_email_read
            </span>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            Verify Email
          </h1>
          <p className="text-text-secondary mt-2">
            Enter the code sent to{" "}
            <span className="text-white font-semibold">{email}</span>
          </p>
        </div>

        <div className="bg-surface-dark border border-border-dark p-8 rounded-3xl shadow-2xl backdrop-blur-md">
          <form onSubmit={handleVerify} className="space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-danger/20 rounded-xl text-danger text-xs font-bold">
                {error}
              </div>
            )}
            {message && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-xs font-bold">
                {message}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
                Verification Code
              </label>
              <input
                suppressHydrationWarning
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full bg-background-dark border-border-dark rounded-xl text-main text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-3.5 transition-all outline-none text-center tracking-[0.5em] font-mono text-lg"
                placeholder="• • • • • •"
                maxLength={8}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="cursor-pointer w-full py-4 bg-primary text-white rounded-2xl font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {loading ? (
                <div className="size-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
              ) : (
                "Verify Email"
              )}
            </button>
          </form>

          <button
            onClick={handleResend}
            disabled={loading}
            className="cursor-pointer w-full mt-4 py-3 bg-white/5 border border-border-dark text-main text-xs font-bold rounded-xl hover:bg-white/10 transition-all disabled:opacity-50"
          >
            Resend Code
          </button>

          <p className="text-center mt-6 text-text-secondary text-xs">
            <button
              onClick={() => router.push("/login")}
              className="cursor-pointer text-primary font-bold hover:underline"
            >
              Back to Login
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full bg-[#0d1117] flex items-center justify-center">
          <div className="size-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
