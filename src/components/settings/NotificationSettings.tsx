"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { NotificationPreferences } from "@/types";
import { requestNotificationPermission } from "@/lib/browser-notifications";

const NotificationSettings: React.FC = () => {
  const { notificationPreferences, updateNotificationPreferences } =
    useAppContext();
  const { addToast } = useUIContext();

  const [localPreferences, setLocalPreferences] =
    useState<NotificationPreferences>(notificationPreferences);
  const [isSaving, setIsSaving] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setLocalPreferences(notificationPreferences);
  }, [notificationPreferences]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermissionStatus(Notification.permission);
    } else {
      setPermissionStatus("unsupported");
    }
  }, []);

  const togglePref = (key: keyof NotificationPreferences) => {
    setLocalPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hasChanges = useMemo(
    () =>
      Object.keys(localPreferences).some((key) => {
        const typedKey = key as keyof NotificationPreferences;
        return localPreferences[typedKey] !== notificationPreferences[typedKey];
      }),
    [localPreferences, notificationPreferences],
  );

  const handleSave = async () => {
    if (!hasChanges) return;
    setIsSaving(true);
    try {
      await updateNotificationPreferences(localPreferences);
      addToast("Notification preferences saved.", "success");
      if (localPreferences.browserNotifications && permissionStatus !== "granted" && permissionStatus !== "unsupported") {
        const result = await requestNotificationPermission();
        setPermissionStatus(result);
      }
    } catch {
      addToast("Failed to save notification preferences.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setLocalPreferences(notificationPreferences);
    addToast("Notification preference changes discarded.", "info");
  };

  const sections = [
    {
      title: "Global Preferences",
      items: [
        {
          id: "globalDnd",
          label: "Do Not Disturb",
          desc: "Silence all incoming activity notifications and system alerts.",
          icon: "do_not_disturb_on",
        },
        {
          id: "browserNotifications",
          label: "Browser Notifications",
          desc: "Allow DevFlow Pro to send push alerts even when the tab is inactive.",
          icon: "notifications_active",
        },
      ],
    },
    {
      title: "Task Management",
      items: [
        {
          id: "taskAssignments",
          label: "Assignments",
          desc: "Notify me when I am assigned to a new task or sub-task.",
          icon: "assignment_ind",
        },
        {
          id: "taskComments",
          label: "Comments",
          desc: "Alert me for new comments on tasks I am watching or assigned to.",
          icon: "chat_bubble",
        },
        {
          id: "taskStatusChanges",
          label: "Status Changes",
          desc: "Receive updates when tasks in my project change pipeline states.",
          icon: "sync",
        },
      ],
    },
    {
      title: "Version Control",
      items: [
        {
          id: "pullRequestActivity",
          label: "Pull Requests",
          desc: "Notifications for new PRs, reviews, and merge events.",
          icon: "merge_type",
        },
        {
          id: "buildStatus",
          label: "Builds & CI/CD",
          desc: "Alerts for pipeline successes, failures, and deployment triggers.",
          icon: "rocket_launch",
        },
      ],
    },
    {
      title: "Calendar",
      items: [
        {
          id: "calendarEmailEvents",
          label: "Event created from email",
          desc: "In-app alert, browser push, and confirmation email when you add a calendar event from an email.",
          icon: "event",
        },
        {
          id: "calendarEventInvites",
          label: "Calendar invitations",
          desc: "In-app alerts and browser push when you are invited to a workspace calendar event or it changes.",
          icon: "event_available",
        },
        {
          id: "calendarEventInviteEmail",
          label: "Calendar invitation email",
          desc: "Email when you are invited to a workspace calendar event or it is updated or cancelled.",
          icon: "mail",
        },
      ],
    },
    {
      title: "Calls & meetings",
      items: [
        {
          id: "callInvites",
          label: "Call invitations",
          desc: "When you are invited to a workspace video call.",
          icon: "videocam",
        },
        {
          id: "callReminders",
          label: "Call reminders",
          desc: "Scheduled call reminders (15 min and 2 min before start).",
          icon: "schedule",
        },
        {
          id: "callSummaries",
          label: "Call ended",
          desc: "When a call ends and processing begins.",
          icon: "call_end",
        },
        {
          id: "callMeetingTasksReview",
          label: "Meeting tasks to review",
          desc: "When AI-created meeting tasks are ready for your review.",
          icon: "playlist_add_check",
        },
      ],
    },
    {
      title: "Account & Security",
      items: [
        {
          id: "securityAlerts",
          label: "Security Updates",
          desc: "Immediate alerts for new logins, password changes, and API key updates.",
          icon: "security",
        },
        {
          id: "newEmails",
          label: "Email Integration",
          desc: "Receive a notification within the app when a new important email arrives.",
          icon: "mail",
        },
      ],
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300 pb-20">
      {sections.map((section) => (
        <section
          key={section.title}
          className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm"
        >
          <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-6">
            {section.title}
          </h3>
          <div className="divide-y divide-white/5">
            {section.items.map((item) => (
              <div key={item.id} className="first:pt-0 last:pb-0">
                <div className="py-5 flex items-center justify-between group">
                  <div className="flex gap-5 items-start">
                    <div className="size-10 rounded-xl bg-background-dark border border-white/5 flex items-center justify-center text-text-secondary group-hover:text-primary transition-all shrink-0">
                      <span className="material-symbols-outlined text-[20px]">
                        {item.icon}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-bold text-white group-hover:text-primary transition-colors">
                        {item.label}
                      </span>
                      <span className="text-xs text-text-secondary max-w-md">
                        {item.desc}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    title={`Toggle ${item.label}`}
                    onClick={() =>
                      togglePref(item.id as keyof NotificationPreferences)
                    }
                    className={`cursor-pointer relative w-11 h-6 rounded-full transition-all duration-300 shrink-0 ml-4 ${localPreferences[item.id as keyof NotificationPreferences] ? "bg-primary" : "bg-slate-700"}`}
                  >
                    <span
                      className={`absolute top-1 size-4 bg-white rounded-full transition-all duration-300 shadow-sm ${localPreferences[item.id as keyof NotificationPreferences] ? "left-6" : "left-1"}`}
                    ></span>
                  </button>
                </div>
                {item.id === "browserNotifications" && localPreferences.browserNotifications && permissionStatus === "denied" && (
                  <p className="pb-4 text-xs text-amber-400 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">warning</span>
                    Browser permission was denied. Re-enable it in your browser settings.
                  </p>
                )}
                {item.id === "browserNotifications" && localPreferences.browserNotifications && permissionStatus === "default" && (
                  <p className="pb-4 text-xs text-text-secondary flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">info</span>
                    Save preferences to be prompted for browser permission.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
        <button
          onClick={handleDiscard}
          disabled={!hasChanges || isSaving}
          className="px-6 py-2.5 rounded-xl text-text-secondary text-sm font-bold hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Discard
        </button>
        <button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="px-6 py-2.5 bg-primary text-white text-sm font-black rounded-xl shadow-lg shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {isSaving ? "Saving..." : "Save Preferences"}
        </button>
      </div>
    </div>
  );
};

export default NotificationSettings;
