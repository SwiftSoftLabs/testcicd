"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import OnboardingModal from "./OnboardingModal";
import SpotlightTip from "./SpotlightTip";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type TourStep =
  | "welcome"
  | "tour-workspace"
  | "tour-project"
  | "tour-invite-nav" // spotlight sidebar Settings, tooltip has "Invite teammates" CTA
  | "tour-invite-action" // spotlight Add Members card on /settings/workspace
  | "joiner-welcome"
  | "joiner-waiting-for-projects"
  | "joiner-tour-workspace"
  | "joiner-tour-projects"
  | "joiner-tour-tasks"
  | "done";

// Stores the current TourStep string; absent means done or never started.
const STEP_KEY = "onework_onboarding_step";

const VALID_STEPS = new Set<string>([
  "welcome",
  "tour-workspace",
  "tour-project",
  "tour-invite-nav",
  "tour-invite-action",
  "joiner-welcome",
  "joiner-waiting-for-projects",
  "joiner-tour-workspace",
  "joiner-tour-projects",
  "joiner-tour-tasks",
]);

function isJoinerStep(step: TourStep): boolean {
  return (
    step === "joiner-welcome" ||
    step === "joiner-waiting-for-projects" ||
    step === "joiner-tour-workspace" ||
    step === "joiner-tour-projects" ||
    step === "joiner-tour-tasks"
  );
}

function isStoredStepCompatible(
  step: TourStep,
  isJoiner: boolean,
  hasWorkspace: boolean,
  hasProject: boolean,
): boolean {
  if (step === "joiner-welcome") {
    return isJoiner;
  }

  if (step === "joiner-waiting-for-projects") {
    return isJoiner && hasWorkspace && !hasProject;
  }

  if (
    step === "joiner-tour-workspace" ||
    step === "joiner-tour-projects" ||
    step === "joiner-tour-tasks"
  ) {
    return isJoiner && hasProject;
  }

  if (step === "welcome" || step === "tour-workspace") {
    return !isJoiner && !hasWorkspace;
  }

  return !isJoiner;
}

const OnboardingManager: React.FC = () => {
  const router = useRouter();
  const {
    currentUser,
    workspaces,
    projects,
    isLoading,
    projectsSettled,
    pendingJoinNotification,
    clearPendingJoinNotification,
    updateCurrentUser,
  } = useAppContext();
  const { addToast } = useUIContext();

  const [tourStep, setTourStep] = useState<TourStep>("done");
  const [initialized, setInitialized] = useState(false);

  const hasWorkspace = workspaces.length > 0;
  const hasProject = projects.length > 0;
  const isJoiner = currentUser?.onboarding_type === "joiner";
  const stepStorageKey = currentUser?.id
    ? `${STEP_KEY}:${currentUser.id}`
    : STEP_KEY;
  const joinerRoutingReady = !isJoiner || !hasWorkspace || projectsSettled;

  // Capture the initial workspaces reference before any fetch fires.
  // After refreshWorkspaces() completes, AppContext sets state with a new array
  // reference — even if empty. workspaces !== initialWorkspacesRef.current means
  // the fetch has responded at least once and the data is authoritative.
  const initialWorkspacesRef = useRef(workspaces);
  const workspacesSettled =
    hasWorkspace || workspaces !== initialWorkspacesRef.current;

  const finishTour = useCallback(async () => {
    if (currentUser?.id && currentUser.onboarding_type === "joiner") {
      try {
        const response = await authenticatedFetch("/api/profile/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onboarding_type: "creator" }),
        });

        if (response.ok) {
          updateCurrentUser({ onboarding_type: "creator" });
        }
      } catch (error) {
        console.error("Failed to persist joiner onboarding completion:", error);
      }
    }

    localStorage.removeItem(STEP_KEY);
    addToast("You're all set! Feel free to explore OneWork.", "success");
    setTourStep("done");
  }, [
    addToast,
    currentUser?.id,
    currentUser?.onboarding_type,
    updateCurrentUser,
  ]);

  const clearStoredStep = useCallback(() => {
    localStorage.removeItem(STEP_KEY);
    if (stepStorageKey !== STEP_KEY) {
      localStorage.removeItem(stepStorageKey);
    }
  }, [stepStorageKey]);

  const goToInvite = useCallback(() => {
    setTourStep("tour-invite-action");
    router.push("/settings/workspace");
  }, [router]);

  // Persist current step so the tour resumes after a reload or app exit.
  // Removing the key on 'done' keeps storage clean.
  useEffect(() => {
    if (!initialized) return;
    if (tourStep === "done") {
      clearStoredStep();
    } else {
      localStorage.setItem(stepStorageKey, tourStep);
      if (stepStorageKey !== STEP_KEY) {
        localStorage.removeItem(STEP_KEY);
      }
    }
  }, [clearStoredStep, stepStorageKey, tourStep, initialized]);

  // Initialize only after workspace data has actually been fetched.
  useEffect(() => {
    if (isLoading || !workspacesSettled || initialized) return;
    if (isJoiner && hasWorkspace && !projectsSettled) return;
    setInitialized(true);

    const stored =
      localStorage.getItem(stepStorageKey) ?? localStorage.getItem(STEP_KEY);
    const restoredStep =
      stored && VALID_STEPS.has(stored) ? (stored as TourStep) : null;

    if (
      restoredStep &&
      isStoredStepCompatible(restoredStep, isJoiner, hasWorkspace, hasProject)
    ) {
      // Resume where the user left off. The advance effects below will
      // fast-forward the step if the user completed actions outside the tour
      // (e.g. stored=tour-workspace but hasWorkspace=true → advances to tour-project).
      if (stepStorageKey !== STEP_KEY) {
        localStorage.setItem(stepStorageKey, restoredStep);
        localStorage.removeItem(STEP_KEY);
      }
      setTourStep(restoredStep);
      return;
    }

    clearStoredStep();

    if (isJoiner) {
      if (restoredStep === "joiner-waiting-for-projects" && hasProject) {
        setTourStep("joiner-tour-projects");
        return;
      }

      if (
        (restoredStep === "joiner-tour-workspace" ||
          restoredStep === "joiner-tour-projects" ||
          restoredStep === "joiner-tour-tasks") &&
        !hasProject
      ) {
        setTourStep("joiner-waiting-for-projects");
        return;
      }

      setTourStep("joiner-welcome");
      return;
    }

    // No persisted step — determine state from scratch
    if (hasWorkspace) {
      setTourStep("done");
    } else {
      setTourStep("welcome");
    }
  }, [
    clearStoredStep,
    currentUser?.onboarding_type,
    hasProject,
    hasWorkspace,
    initialized,
    isJoiner,
    isLoading,
    projectsSettled,
    stepStorageKey,
    workspacesSettled,
  ]);

  // Show toast for experienced users (U3/U4) who were added to a new workspace
  useEffect(() => {
    if (!pendingJoinNotification) return;
    addToast(`You've been added to ${pendingJoinNotification}.`, "info");
    clearPendingJoinNotification();
  }, [pendingJoinNotification, addToast, clearPendingJoinNotification]);

  // Advance tour-workspace → tour-project when workspace is created
  useEffect(() => {
    if (tourStep === "tour-workspace" && hasWorkspace) {
      setTourStep("tour-project");
    }
  }, [tourStep, hasWorkspace]);

  // Advance tour-project → tour-invite-nav when project is created
  useEffect(() => {
    if (tourStep === "tour-project" && hasProject) {
      setTourStep("tour-invite-nav");
    }
  }, [tourStep, hasProject]);

  if (isLoading || !workspacesSettled || !joinerRoutingReady) return null;
  if (tourStep === "done") return null;

  if (tourStep === "welcome") {
    return (
      <OnboardingModal
        onStart={() => {
          if (!hasWorkspace) {
            setTourStep("tour-workspace");
          } else if (!hasProject) {
            setTourStep("tour-project");
          } else {
            setTourStep("tour-invite-nav");
          }
        }}
      />
    );
  }

  if (tourStep === "tour-workspace") {
    return (
      <SpotlightTip
        targets={["workspace-name-input", "create-workspace"]}
        overlayTitle="Create your workspace"
        overlayDescription="A workspace is your team's home. Click here to set it up."
        guideTitle="Name your workspace"
        guideDescription="Type your workspace name — your company, team, or project. Then hit Create Workspace."
        step={1}
        totalSteps={3}
        onSkip={finishTour}
        skipLabel="Skip tour"
      />
    );
  }

  if (tourStep === "tour-project") {
    return (
      <SpotlightTip
        targets={["project-name-input", "create-project"]}
        overlayTitle="Create your first project"
        overlayDescription="Projects organize your tasks, sprints, and code. Click here to create one."
        guideTitle="Name your project"
        guideDescription="Give your project a name. Description is optional. A default color is already selected — change it if you like."
        step={2}
        totalSteps={3}
        onSkip={finishTour}
        skipLabel="Skip"
      />
    );
  }

  if (tourStep === "tour-invite-nav") {
    return (
      <SpotlightTip
        targets={["settings-invite"]}
        overlayTitle="Invite your team"
        overlayDescription="Head to Settings to invite teammates to your workspace. This step is optional."
        guideTitle="Invite your team"
        guideDescription="Head to Settings to invite teammates to your workspace. This step is optional."
        step={3}
        totalSteps={3}
        actionLabel="Invite teammates →"
        onAction={goToInvite}
        onSkip={finishTour}
        skipLabel="Skip"
      />
    );
  }

  if (tourStep === "tour-invite-action") {
    return (
      <SpotlightTip
        targets={["add-members-card"]}
        overlayTitle="Add teammates"
        overlayDescription="Enter a colleague's email and click Add. They need a OneWork account to join."
        guideTitle="Add teammates"
        guideDescription="Enter a colleague's email and click Add. They need a OneWork account to join."
        step={3}
        totalSteps={3}
        actionLabel="Got it"
        onAction={finishTour}
        onSkip={finishTour}
        skipLabel="Skip"
      />
    );
  }

  if (tourStep === "joiner-welcome") {
    return (
      <OnboardingModal
        variant="joiner"
        workspaceName={workspaces[0]?.name}
        onStart={() =>
          setTourStep(
            hasProject
              ? "joiner-tour-workspace"
              : "joiner-waiting-for-projects",
          )
        }
      />
    );
  }

  if (tourStep === "joiner-waiting-for-projects") {
    return (
      <OnboardingModal
        variant="joiner-empty"
        workspaceName={workspaces[0]?.name}
        onStart={finishTour}
      />
    );
  }

  if (tourStep === "joiner-tour-workspace") {
    return (
      <SpotlightTip
        targets={["sidebar-workspace"]}
        overlayTitle="Your workspace"
        overlayDescription="This is the workspace you've been added to. You can switch workspaces here any time."
        guideTitle="Your workspace"
        guideDescription="This is the workspace you've been added to. You can switch workspaces here any time."
        step={1}
        totalSteps={3}
        actionLabel="Next →"
        onAction={() => setTourStep("joiner-tour-projects")}
        onSkip={finishTour}
        skipLabel="Skip"
      />
    );
  }

  if (tourStep === "joiner-tour-projects") {
    return (
      <SpotlightTip
        targets={["sidebar-projects"]}
        overlayTitle="Your team's projects"
        overlayDescription="All active projects live here in the sidebar. Click any project to open its task board."
        guideTitle="Your team's projects"
        guideDescription="All active projects live here in the sidebar. Click any project to open its task board."
        step={2}
        totalSteps={3}
        actionLabel="Next →"
        onAction={() => setTourStep("joiner-tour-tasks")}
        onSkip={finishTour}
        skipLabel="Skip"
      />
    );
  }

  if (tourStep === "joiner-tour-tasks") {
    return (
      <SpotlightTip
        targets={["dashboard-main"]}
        overlayTitle="Your workspace"
        overlayDescription="Tasks assigned to you, sprint progress, and team activity show up here. You're all set!"
        guideTitle="Your workspace"
        guideDescription="Tasks assigned to you, sprint progress, and team activity show up here. You're all set!"
        step={3}
        totalSteps={3}
        actionLabel="Got it"
        onAction={finishTour}
        onSkip={finishTour}
        skipLabel="Skip"
      />
    );
  }

  return null;
};

export default OnboardingManager;
