"use client";

import { persistNativeAuthSession } from "@/lib/auth/client-session";
import { insforgeNative } from "@/lib/insforge/native";
import { useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function InviteCallbackInner() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function handleInvite() {
      try {
        // InsForge (Supabase-compatible) auto-processes the #access_token
        // from the URL hash on SDK init. getCurrentUser() returns the session
        // that was set by the invite token.
        const { data, error } = await insforgeNative.auth.getCurrentUser();

        if (error || !data?.user) {
          setErrorMsg(
            "Invalid or expired invite link. Please ask to be re-invited.",
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
            "Could not save your session. Please try the invite link again.",
          );
          setStatus("error");
          return;
        }

        window.location.replace("/dashboard");
      } catch (err) {
        console.error("Invite callback error:", err);
        setErrorMsg(
          "An error occurred while accepting your invite. Please try again.",
        );
        setStatus("error");
      }
    }

    handleInvite();
  }, []);

  if (status === "error") {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <span className="material-symbols-outlined text-red-400 text-6xl">
            error
          </span>
          <h2 className="text-white text-xl font-bold">Invite Failed</h2>
          <p className="text-gray-400 text-sm max-w-sm">{errorMsg}</p>
          <button
            onClick={() => router.push("/login")}
            className="cursor-pointer mt-4 px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-blue-600 transition-all"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="size-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
        <p className="text-gray-400 text-sm font-medium">
          Setting up your account…
        </p>
      </div>
    </div>
  );
}

export default function InviteCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
          <div className="size-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <InviteCallbackInner />
    </Suspense>
  );
}
