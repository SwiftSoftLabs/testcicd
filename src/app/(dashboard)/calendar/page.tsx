"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUIContext } from "@/context/UIContext";
import { CalendarHeader } from "@/components/calendar/CalendarHeader";
import {
  CalendarLegend,
  type FilterKey,
} from "@/components/calendar/CalendarLegend";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { DayView } from "@/components/calendar/DayView";
import ProjectScopeSelect from "@/components/ProjectScopeSelect";
import { usePageProjectScope } from "@/hooks/usePageProjectScope";
import type { CalendarDisplayItem, CalendarEventDTO } from "@/types/calendar";
import { useAppContext } from "@/context/AppContext";

const DEFAULT_ACTIVE_FILTERS: Record<FilterKey, boolean> = {
  myEvents: true,
  workspaceEvents: true,
  projectEvents: true,
  emailEvents: true,
  pluginEvents: true,
  tasks: true,
};

function parseTaskDueDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (year && month && day) return new Date(year, month - 1, day);
  return new Date(value);
}

function addHours(date: Date, hours: number): Date {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function getVisibleRange(date: Date, view: "month" | "week" | "day") {
  if (view === "month") {
    return {
      start: new Date(date.getFullYear(), date.getMonth(), 1),
      end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
    };
  }

  if (view === "week") {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start, end };
}

function CalendarLoadingSpinner() {
  return (
    <div className="h-full flex items-center justify-center bg-background-dark">
      <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function CalendarPageInner() {
  const { addToast, openModal } = useUIContext();
  const searchParams = useSearchParams();
  const eventIdFromParam = searchParams.get("eventId");
  const {
    tasks,
    projects,
    selectedWorkspaceId,
    projectsSettled,
    setSelectedProjectId,
    calendars,
    nativeEvents,
    fetchNativeEvents,
  } = useAppContext();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeView, setActiveView] = useState<"month" | "week" | "day">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "month",
  );
  const [activeFilters, setActiveFilters] = useState<
    Record<FilterKey, boolean>
  >(DEFAULT_ACTIVE_FILTERS);
  const projectsReady = !selectedWorkspaceId || projectsSettled;
  const { selectedProjectId, setProjectId } = usePageProjectScope(projects, {
    storageKey: selectedWorkspaceId
      ? `ow-selected-project-id:${selectedWorkspaceId}`
      : null,
    projectsReady,
    onProjectChange: setSelectedProjectId,
  });
  const isLockedProject = Boolean(
    projects.find((project) => project.id === selectedProjectId)?.quota_locked,
  );
  const visibleRange = useMemo(
    () => getVisibleRange(currentDate, activeView),
    [currentDate, activeView],
  );

  const { taskItems, eventItems } = useMemo(() => {
    const nextTaskItems: CalendarDisplayItem[] = tasks
      .filter(
        (task) =>
          task.dueDate &&
          (!selectedWorkspaceId || task.projectId === selectedProjectId),
      )
      .map((task) => {
        const date = parseTaskDueDate(task.dueDate!);
        return {
          source: "task",
          id: `task-${task.id}`,
          title: task.title,
          description: task.description ?? null,
          projectId: task.projectId ?? null,
          start: date,
          end: addHours(date, 1),
          day: date.getDate(),
          month: date.getMonth(),
          year: date.getFullYear(),
          isAllDay: true,
          color: null,
          task,
        };
      });

    const nextEventItems: CalendarDisplayItem[] = nativeEvents
      .filter((event) => {
        const start = new Date(event.startTime);
        const end = new Date(event.endTime);
        return (
          start < visibleRange.end &&
          end > visibleRange.start &&
          (!selectedWorkspaceId ||
            event.projectId === selectedProjectId ||
            event.projectId === null)
        );
      })
      .map((event) => {
        const start = new Date(event.startTime);
        const end = new Date(event.endTime);
        const calendar = calendars.find((item) => item.id === event.calendarId);
        return {
          source: "event",
          id: `event-${event.id}`,
          title: event.title,
          description: event.description,
          projectId: event.projectId,
          accountId: event.accountId,
          eventScope: event.scope,
          eventSource: event.source,
          sourceMailAccountId: event.sourceMailAccountId,
          sourceMessageId: event.sourceMessageId,
          start,
          end,
          day: start.getDate(),
          month: start.getMonth(),
          year: start.getFullYear(),
          isAllDay: event.isAllDay,
          color: calendar?.color ?? null,
          event,
        };
      });

    return { taskItems: nextTaskItems, eventItems: nextEventItems };
  }, [
    calendars,
    nativeEvents,
    selectedProjectId,
    selectedWorkspaceId,
    tasks,
    visibleRange.end,
    visibleRange.start,
  ]);

  const legendCounts = useMemo<Record<FilterKey, number>>(() => {
    const counts: Record<FilterKey, number> = {
      myEvents: 0,
      workspaceEvents: 0,
      projectEvents: 0,
      emailEvents: 0,
      pluginEvents: 0,
      tasks: taskItems.length,
    };

    for (const item of eventItems) {
      if (item.source !== 'event') continue;
      if (item.eventSource === 'plugin') {
        counts.pluginEvents += 1;
        continue;
      }
      if (item.eventSource === 'email') {
        counts.emailEvents += 1;
        continue;
      }
      if (item.eventScope === 'workspace') {
        counts.workspaceEvents += 1;
        continue;
      }
      if (item.eventScope === 'project') {
        counts.projectEvents += 1;
        continue;
      }
      if (item.eventScope === 'account') counts.myEvents += 1;
    }

    return counts;
  }, [eventItems, taskItems.length]);

  const calendarItems = useMemo<CalendarDisplayItem[]>(() => {
    const filteredTaskItems = activeFilters.tasks ? taskItems : [];
    const filteredEventItems = eventItems.filter((item) => {
      if (item.source !== 'event') return true;
      if (item.eventSource === 'plugin') return activeFilters.pluginEvents;
      if (item.eventSource === 'email') return activeFilters.emailEvents;
      if (item.eventScope === 'workspace') return activeFilters.workspaceEvents;
      if (item.eventScope === 'project') return activeFilters.projectEvents;
      if (item.eventScope === 'account') return activeFilters.myEvents;
      return true;
    });

    return [...filteredEventItems, ...filteredTaskItems].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
  }, [activeFilters, eventItems, taskItems]);

  const handleNav = (direction: "prev" | "next") => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (activeView === "month") {
        next.setMonth(prev.getMonth() + (direction === "prev" ? -1 : 1));
      } else if (activeView === "week") {
        next.setDate(prev.getDate() + (direction === "prev" ? -7 : 7));
      } else {
        next.setDate(prev.getDate() + (direction === "prev" ? -1 : 1));
      }
      return next;
    });
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    addToast("Returning to today", "info");
  };

  const openEventModal = useCallback(
    (start: Date, event?: CalendarEventDTO) => {
      const eventProject = event?.projectId
        ? projects.find((project) => project.id === event.projectId)
        : null;
      const modalReadOnly = event
        ? eventProject?.quota_locked === true
        : isLockedProject;
      if (!event && modalReadOnly) {
        addToast(
          "This project is read-only because your workspace is over its plan limit.",
          "warning",
        );
        return;
      }
      const end = event ? new Date(event.endTime) : addHours(start, 1);
      openModal("calendar-event", {
        calendars,
        projects,
        workspaceId: selectedWorkspaceId,
        event,
        initialStart: start.toISOString(),
        initialEnd: end.toISOString(),
        initialProjectId: selectedProjectId,
        readOnly: modalReadOnly,
        onSaved: fetchNativeEvents,
        ariaLabel: event ? "Edit event" : "Create event",
      });
    },
    [
      calendars,
      addToast,
      fetchNativeEvents,
      isLockedProject,
      openModal,
      projects,
      selectedProjectId,
      selectedWorkspaceId,
    ],
  );

  // Optional deep link from notification click: /calendar?eventId=<uuid>
  const openedEventFromParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!eventIdFromParam) return;
    if (!projectsSettled) return;
    if (openedEventFromParamRef.current === eventIdFromParam) return;

    const match = eventItems.find((item) => {
      if (item.source !== "event") return false;
      return item.event.id === eventIdFromParam;
    });
    if (!match || match.source !== "event") return;

    openedEventFromParamRef.current = eventIdFromParam;
    openEventModal(match.start, match.event);
  }, [eventIdFromParam, eventItems, openEventModal, projectsSettled]);

  const handleDayClick = (day: number, month?: number, year?: number) => {
    const selectedDate = new Date(
      year ?? currentDate.getFullYear(),
      month ?? currentDate.getMonth(),
      day,
    );
    selectedDate.setHours(9, 0, 0, 0);
    openEventModal(selectedDate);
  };

  const handleItemClick = (item: CalendarDisplayItem) => {
    if (item.source === "task") {
      openModal("task-detail", { task: item.task });
      return;
    }
    openEventModal(item.start, item.event);
  };

  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const daysOfWeekShort = ["S", "M", "T", "W", "T", "F", "S"];

  if (selectedWorkspaceId && !projectsSettled) {
    return <CalendarLoadingSpinner />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background-dark">
      <CalendarHeader
        currentDate={currentDate}
        view={activeView}
        onViewChange={setActiveView}
        onNavigate={handleNav}
        onToday={handleToday}
        onCreateEvent={() => {
          const start = new Date(currentDate);
          start.setHours(9, 0, 0, 0);
          openEventModal(start);
        }}
        createDisabled={isLockedProject}
        projectSelector={
          selectedWorkspaceId ? (
            <ProjectScopeSelect
              projects={projects}
              selectedProjectId={selectedProjectId}
              onChange={setProjectId}
              className="w-full"
            />
          ) : undefined
        }
        filterLegend={
          <CalendarLegend
            filters={activeFilters}
            onChange={(key) => {
              setActiveFilters((prev) => ({ ...prev, [key]: !prev[key] }));
            }}
            counts={legendCounts}
          />
        }
      />
      {!selectedWorkspaceId && (
        <div className="shrink-0 border-b border-border-dark bg-surface-dark/20 px-6 py-2 text-xs font-medium text-text-secondary">
          Private events live in your OneWork account and are visible only to
          you.
        </div>
      )}
      {selectedProjectId && (
        <div className="shrink-0 border-b border-border-dark bg-surface-dark/20 px-6 py-2 text-xs font-medium text-text-secondary">
          Workspace-wide events appear in every project calendar.
        </div>
      )}
      {isLockedProject && (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-6 py-2 text-xs font-medium text-amber-200">
          This project calendar is read-only because your workspace is over its plan limit. Upgrade to restore editing.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto custom-scrollbar bg-background-dark">
        {activeView !== "day" && (
          <div className="sticky top-0 z-10 grid shrink-0 grid-cols-7 border-b border-border-dark bg-surface-dark/30">
            {daysOfWeek.map((day, idx) => (
              <div
                key={day}
                className="py-2 md:py-3 text-center text-[10px] font-black text-text-secondary uppercase tracking-normal md:tracking-widest border-r border-border-dark last:border-0"
              >
                <span className="hidden sm:inline">{day}</span>
                <span className="sm:hidden">{daysOfWeekShort[idx]}</span>
              </div>
            ))}
          </div>
        )}

        {activeView === "month" && (
          <MonthView
            currentDate={currentDate}
            onDayClick={(day) => {
              if (!isLockedProject) handleDayClick(day);
            }}
            events={calendarItems}
            onItemClick={handleItemClick}
            showWorkspaceBadge={Boolean(selectedProjectId)}
            createDisabled={isLockedProject}
          />
        )}
        {activeView === "week" && (
          <WeekView
            currentDate={currentDate}
            onDayClick={(day, month, year) => {
              if (!isLockedProject) handleDayClick(day, month, year);
            }}
            events={calendarItems}
            onItemClick={handleItemClick}
            showWorkspaceBadge={Boolean(selectedProjectId)}
            createDisabled={isLockedProject}
          />
        )}
        {activeView === "day" && (
          <DayView
            currentDate={currentDate}
            onAddEvent={() => {
              if (isLockedProject) return;
              const start = new Date(currentDate);
              start.setHours(9, 0, 0, 0);
              openEventModal(start);
            }}
            events={calendarItems}
            onItemClick={handleItemClick}
            showWorkspaceBadge={Boolean(selectedProjectId)}
            createDisabled={isLockedProject}
          />
        )}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarLoadingSpinner />}>
      <CalendarPageInner />
    </Suspense>
  );
}
