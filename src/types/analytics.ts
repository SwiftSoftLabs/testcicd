import type { Status } from "@/types";

export interface TeamScopeOption {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  source: "workspace" | "team";
  leadId?: string | null;
}

export interface AnalyticsTrendPoint {
  key: string;
  label: string;
  completed: number;
  created: number;
}

export interface TeamStatusCount {
  status: Status;
  count: number;
}

export interface TeamTagBreakdown {
  label: string;
  taskCount: number;
  estimatedHours: number;
}

export interface TeamWorkloadMember {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: string;
  assignedTasks: number;
  openTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionRate: number;
  estimatedHours: number;
  loggedHours: number;
}

export interface TeamRiskTask {
  id: string;
  title: string;
  status: Status;
  priority: string;
  dueDate?: string;
  assigneeId: string;
  assigneeName: string;
  estimatedHours: number;
  loggedHours: number;
  daysOverdue: number;
}

export interface TeamPerformanceAnalytics {
  scope: TeamScopeOption;
  tasksCount: number;
  completedTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  completionRate: number;
  activeMembers: number;
  estimatedHours: number;
  loggedHours: number;
  avgEstimatedHours: number;
  avgLoggedHours: number;
  statusCounts: TeamStatusCount[];
  trend: AnalyticsTrendPoint[];
  tagBreakdown: TeamTagBreakdown[];
  members: TeamWorkloadMember[];
  riskTasks: TeamRiskTask[];
}
