import { NotificationPreferences } from "@/types";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  globalDnd: false,
  browserNotifications: true,
  taskAssignments: true,
  taskComments: true,
  taskStatusChanges: true,
  pullRequestActivity: true,
  buildStatus: true,
  securityAlerts: true,
  newEmails: true,
  fileUploads: true,
  callInvites: true,
  callReminders: true,
  callSummaries: true,
  callMeetingTasksReview: true,
  calendarEmailEvents: true,
  calendarEventInvites: true,
  calendarEventInviteEmail: true,
};
