import React, { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import ModalManager from "@/components/ModalManager";
import ToastContainer from "@/components/ToastContainer";
import WorkspaceRouteNormalizer from "@/components/WorkspaceRouteNormalizer";
import { UIProvider } from "@/context/UIContext";
import { AssistantPageContextBridgeProvider } from "@/context/AssistantPageContextBridge";
import { AssistantSessionProvider } from "@/context/AssistantSessionContext";

import PageTransition from "@/components/PageTransition";
import OnboardingManager from "@/components/onboarding/OnboardingManager";
import QuickTaskbar from "@/components/quick-actions/QuickTaskbar";
import { DashboardCallSession } from "@/components/DashboardCallSession";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UIProvider>
      <AssistantPageContextBridgeProvider>
      <AssistantSessionProvider>
      <DashboardCallSession>
        <div className="flex h-screen w-full bg-background-dark text-text-primary overflow-hidden">
          <Suspense fallback={null}>
            <WorkspaceRouteNormalizer />
          </Suspense>
          <Sidebar />

          <div className="flex-1 flex flex-col min-w-0 h-full relative">
            <Header />
            <main
              data-tour="dashboard-main"
              className="dashboard-scroll-frame flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-background-dark relative"
            >
              <PageTransition>{children}</PageTransition>
            </main>
            <QuickTaskbar />
          </div>

          <div id="modal-root"></div>
          <OnboardingManager />
          <ModalManager />
          <ToastContainer />
        </div>
      </DashboardCallSession>
      </AssistantSessionProvider>
      </AssistantPageContextBridgeProvider>
    </UIProvider>
  );
}
