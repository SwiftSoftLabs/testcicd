"use client";

import type { PlanCode } from "@/types/billing";

interface WorkspacePlanBadgeProps {
  planName: string;
  planCode: PlanCode;
  isLoading?: boolean;
  className?: string;
}

/** Kelviq-style status pill: soft tinted fill, saturated label, no border/shadow. */
function tierClassName(planCode: PlanCode): string {
  switch (planCode) {
    case "pro":
      return "light:bg-blue-50 light:text-blue-700 dark:bg-blue-500/15 dark:text-blue-200";
    case "max":
      return "light:bg-orange-50 light:text-orange-700 dark:bg-orange-500/15 dark:text-orange-200";
    case "enterprise":
      return "light:bg-violet-100 light:text-violet-700 dark:bg-violet-500/15 dark:text-violet-200";
    default:
      return "light:bg-slate-100 light:text-slate-600 dark:bg-white/10 dark:text-slate-300";
  }
}

function displayPlanLabel(planName: string, planCode: PlanCode): string {
  if (planCode === "basic") return "Free";
  return planName;
}

const WorkspacePlanBadge: React.FC<WorkspacePlanBadgeProps> = ({
  planName,
  planCode,
  isLoading = false,
  className = "",
}) => {
  if (isLoading || !planName) {
    return null;
  }

  const label = displayPlanLabel(planName, planCode);

  return (
    <span
      className={`shrink-0 inline-flex items-center text-[11px] font-semibold leading-none px-2.5 py-1 rounded-lg ${tierClassName(planCode)} ${className}`.trim()}
      title={`${planName} workspace plan`}
    >
      {label}
    </span>
  );
};

export default WorkspacePlanBadge;
