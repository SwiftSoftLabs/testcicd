"use client";

import { clearManualSignOutMarker, persistNativeAuthSession } from "@/lib/auth/client-session";
import { insforgeNative } from "@/lib/insforge/native";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function OAuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function handleCallback() {
      try {
        const { data, error } = await insforgeNative.auth.getCurrentUser();

        if (error || !data?.user) {
          setErrorMsg(
            "Failed to get OAuth session. Please try logging in again.",
          );
          setStatus("error");
          return;
        }

        const user = data.user;
        const userWithProfile = user as typeof user & {
          profile?: { name?: string };
        };
        const name =
          userWithProfile.profile?.name || user.email?.split("@")[0] || "User";

        localStorage.setItem(
          "ow-current-user",
          JSON.stringify({
            id: user.id,
            email: user.email,
            name,
          }),
        );

        const persisted = await persistNativeAuthSession(user);
        if (!persisted) {
          setErrorMsg(
            "Could not save your session. Please try logging in again.",
          );
          setStatus("error");
          return;
        }

        clearManualSignOutMarker();

        const next =
          searchParams.get("next") ||
          searchParams.get("redirectTo") ||
          "/dashboard";
        window.location.replace(next);
      } catch (err) {
        console.error("OAuth callback error:", err);
        setErrorMsg("An error occurred during login. Please try again.");
        setStatus("error");
      }
    }

    handleCallback();
  }, [router, searchParams]);

  if (status === "error") {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <span className="material-symbols-outlined text-red-400 text-6xl">
            error
          </span>
          <h2 className="text-white text-xl font-bold">Login Failed</h2>
          <p className="text-gray-400 text-sm">{errorMsg}</p>
          <button
            onClick={() => router.push("/login")}
            className="cursor-pointer mt-4 px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-blue-600 transition-all"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="size-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
        <p className="text-gray-400 text-sm font-medium">Completing login...</p>
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
          <div className="size-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <OAuthCallbackInner />
    </Suspense>
  );
}
