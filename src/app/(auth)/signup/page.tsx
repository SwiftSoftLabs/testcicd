"use client";

import { persistClientSessionAndSync } from "@/lib/auth/client-session";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/auth/v1/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          name: fullName,
          // MANIFEST §3: tag user with app_origin at registration time
          data: {
            full_name: fullName,
            avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=random`,
            app_origin: process.env.NEXT_PUBLIC_DB_SCHEMA ?? "app_onework",
          },
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          payload?.message ||
            payload?.error ||
            "Unable to create account at this time. Please try again.",
        );
        return;
      }

      if (payload?.requireEmailVerification) {
        // Redirect to verify email page
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }

      // Signup succeeded directly (no email verification) — save session
      if (payload?.accessToken && payload?.user) {
        const refreshToken: string =
          typeof payload.refreshToken === "string" &&
          payload.refreshToken.length > 0
            ? payload.refreshToken
            : payload.accessToken;
        await persistClientSessionAndSync(
          payload.accessToken,
          refreshToken,
          payload.user,
        );
        localStorage.setItem(
          "ow-current-user",
          JSON.stringify({
            id: payload.user.id,
            email: payload.user.email,
            name:
              payload.user.profile?.name ||
              fullName ||
              payload.user.email?.split("@")[0] ||
              "User",
          }),
        );
      }

      router.refresh();
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create account at this time. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0d1117] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decorations */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] size-[600px] bg-primary/10 rounded-full blur-[120px]"></div>
        <div className="absolute -bottom-[10%] -right-[10%] size-[600px] bg-emerald-500/10 rounded-full blur-[120px]"></div>
      </div>

      <div className="w-full max-w-md z-10">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black text-white tracking-tight">
            Create Account
          </h1>
          <p className="text-text-secondary mt-2">Join OneWork today.</p>
        </div>

        <div className="bg-surface-dark border border-border-dark p-8 rounded-3xl shadow-2xl backdrop-blur-md">
          <form onSubmit={handleSignup} className="space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-danger/20 rounded-xl text-danger text-xs font-bold">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
                Full Name
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-[20px]">
                  person
                </span>
                <input
                  suppressHydrationWarning
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-background-dark border-border-dark rounded-xl text-main text-sm focus:ring-1 focus:ring-primary focus:border-primary pl-12 pr-4 py-3.5 transition-all outline-none"
                  placeholder="John Doe"
                  required
                />
              </div>
            </div>

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
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.2em]">
                Password
              </label>
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
                  placeholder="Create a password"
                  minLength={6}
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
                  Sign Up{" "}
                  <span className="material-symbols-outlined">
                    arrow_forward
                  </span>
                </>
              )}
            </button>
          </form>

          <p className="text-center mt-10 text-text-secondary text-xs">
            Already have an account?{" "}
            <button
              onClick={() => router.push("/login")}
              className="cursor-pointer text-primary font-bold hover:underline"
            >
              Log In
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
