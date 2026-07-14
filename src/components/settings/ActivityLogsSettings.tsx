"use client";

import React, { useState, useMemo } from "react";
import { useUIContext } from "@/context/UIContext";

const ActivityLogsSettings: React.FC = () => {
  const { addToast } = useUIContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterUser, setFilterUser] = useState("All Users");
  const [filterEvent, setFilterEvent] = useState("All Events");
  const [filterTime, setFilterTime] = useState("Last 30 Days");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  const rawLogs = useMemo(
    () => [
      {
        id: 1,
        actor: "Alex Johnson",
        email: "alex.j@prodpro.com",
        action: "Created new project",
        entity: "Design System",
        date: "Oct 24, 2023",
        time: "14:30 PM",
        avatar: "https://picsum.photos/id/64/50/50",
        icon: "add_circle",
        iconColor: "text-emerald-400",
      },
      {
        id: 2,
        actor: "Sarah Smith",
        email: "sarah.s@prodpro.com",
        action: "Modified task priority",
        entity: "Task #402",
        date: "Oct 24, 2023",
        time: "11:15 AM",
        avatar: "https://picsum.photos/id/65/50/50",
        icon: "edit",
        iconColor: "text-orange-400",
      },
      {
        id: 3,
        actor: "Unknown User",
        email: "192.168.1.45",
        action: "Failed login attempt (3x)",
        entity: null,
        date: "Oct 23, 2023",
        time: "03:42 AM",
        avatar: null,
        icon: "error",
        iconColor: "text-red-400",
        isAlert: true,
      },
      {
        id: 4,
        actor: "Alex Johnson",
        email: "alex.j@prodpro.com",
        action: "Invited member to workspace",
        entity: "mike@example.com",
        date: "Oct 23, 2023",
        time: "09:12 AM",
        avatar: "https://picsum.photos/id/64/50/50",
        icon: "person_add",
        iconColor: "text-primary",
      },
      {
        id: 5,
        actor: "System",
        email: "Automated",
        action: "Weekly backup completed",
        entity: "Success",
        date: "Oct 23, 2023",
        time: "00:00 AM",
        avatar: null,
        icon: "cloud_done",
        iconColor: "text-emerald-400",
      },
      {
        id: 6,
        actor: "David Lee",
        email: "david.l@prodpro.com",
        action: "Deleted file",
        entity: "Q3_Report.pdf",
        date: "Oct 22, 2023",
        time: "16:45 PM",
        avatar: "https://picsum.photos/id/66/50/50",
        icon: "delete",
        iconColor: "text-red-400",
      },
      {
        id: 7,
        actor: "System",
        email: "Automated",
        action: "System maintenance",
        entity: "Maintenance",
        date: "Oct 21, 2023",
        time: "02:00 AM",
        avatar: null,
        icon: "settings",
        iconColor: "text-slate-400",
      },
      {
        id: 8,
        actor: "Sarah Smith",
        email: "sarah.s@prodpro.com",
        action: "Merged pull request",
        entity: "PR #401",
        date: "Oct 21, 2023",
        time: "10:00 AM",
        avatar: "https://picsum.photos/id/65/50/50",
        icon: "merge",
        iconColor: "text-purple-400",
      },
    ],
    [],
  );

  const filteredLogs = useMemo(() => {
    return rawLogs.filter((log) => {
      const matchesSearch =
        searchQuery === "" ||
        log.actor.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.action.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesUser =
        filterUser === "All Users" || log.actor === filterUser;
      const matchesEvent =
        filterEvent === "All Events" ||
        log.action
          .toLowerCase()
          .includes(filterEvent.toLowerCase().split(" ")[0]);

      return matchesSearch && matchesUser && matchesEvent;
    });
  }, [rawLogs, searchQuery, filterUser, filterEvent]);

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const currentLogs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(start, start + itemsPerPage);
  }, [filteredLogs, currentPage]);

  const handleExport = () => {
    const headers = [
      "ID",
      "Actor",
      "Email",
      "Action",
      "Entity",
      "Date",
      "Time",
    ];
    const csvContent = [
      headers.join(","),
      ...filteredLogs.map((log) =>
        [
          log.id,
          `"${log.actor}"`,
          `"${log.email}"`,
          `"${log.action}"`,
          `"${log.entity || ""}"`,
          `"${log.date}"`,
          `"${log.time}"`,
        ].join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `activity_logs_${new Date().toISOString().slice(0, 10)}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast("Activity report exported as CSV.", "success");
  };

  const users = useMemo(
    () => ["All Users", ...Array.from(new Set(rawLogs.map((l) => l.actor)))],
    [rawLogs],
  );
  const events = useMemo(
    () => [
      "All Events",
      "Created",
      "Modified",
      "Failed",
      "Invited",
      "Backup",
      "Deleted",
      "Merged",
    ],
    [],
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight">
            Activity Logs
          </h2>
          <p className="text-text-secondary mt-2">
            Monitor events, user actions, and system changes across your
            workspace.
          </p>
        </div>
        <button
          onClick={handleExport}
          className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-surface-dark border border-border-dark text-white text-xs font-bold rounded-lg hover:bg-white/5 transition-all shadow-sm shrink-0"
        >
          <span className="material-symbols-outlined text-sm">download</span>{" "}
          Export CSV
        </button>
      </div>

      <section className="bg-surface-dark border border-border-dark rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border-dark flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm">
              search
            </span>
            <input
              type="text"
              placeholder="Search by user, IP, or event..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-background-dark border-border-dark rounded-xl pl-9 pr-4 py-2 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={filterUser}
              onChange={(e) => {
                setFilterUser(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-background-dark border-border-dark rounded-xl text-[10px] font-bold text-text-secondary uppercase tracking-widest px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
            >
              {users.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <select
              value={filterEvent}
              onChange={(e) => {
                setFilterEvent(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-background-dark border-border-dark rounded-xl text-[10px] font-bold text-text-secondary uppercase tracking-widest px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
            >
              {events.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <select
              value={filterTime}
              onChange={(e) => setFilterTime(e.target.value)}
              className="bg-background-dark border-border-dark rounded-xl text-[10px] font-bold text-text-secondary uppercase tracking-widest px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
            >
              <option>Last 30 Days</option>
              <option>Last 7 Days</option>
              <option>Last 24 Hours</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-background-dark/30 border-b border-border-dark">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                  Actor
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                  Action
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dark">
              {currentLogs.map((log) => (
                <tr
                  key={log.id}
                  className={`hover:bg-white/[0.01] transition-all ${log.isAlert ? "bg-red-500/[0.02]" : ""}`}
                >
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      {log.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={log.avatar}
                          className="size-10 rounded-full border border-border-dark shadow-sm"
                          alt=""
                        />
                      ) : (
                        <div
                          className={`size-10 rounded-xl flex items-center justify-center border border-border-dark ${log.isAlert ? "bg-red-500/10 text-red-500" : "bg-primary/10 text-primary"}`}
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            {log.isAlert
                              ? "warning"
                              : log.actor === "System"
                                ? "settings_suggest"
                                : "person"}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-white truncate">
                          {log.actor}
                        </span>
                        <span
                          className={`text-[10px] font-medium truncate ${log.isAlert ? "text-red-400" : "text-text-secondary"}`}
                        >
                          {log.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-4">
                      <span
                        className={`material-symbols-outlined ${log.iconColor}`}
                      >
                        {log.icon}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-300 font-medium">
                          {log.action}
                        </span>
                        {log.entity && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                              log.entity === "Success"
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : "bg-primary/10 border-primary/20 text-primary"
                            }`}
                          >
                            {log.entity}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5 shrink-0 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-white">
                        {log.date}
                      </span>
                      <span className="text-[10px] text-text-secondary font-medium">
                        {log.time}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {currentLogs.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-6 py-20 text-center text-text-secondary italic text-sm"
                  >
                    No activity records found matching your current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 bg-background-dark/30 border-t border-border-dark flex items-center justify-between">
          <p className="text-xs text-text-secondary">
            Showing{" "}
            <span className="font-bold text-white">
              {currentLogs.length > 0
                ? (currentPage - 1) * itemsPerPage + 1
                : 0}
              -{Math.min(currentPage * itemsPerPage, filteredLogs.length)}
            </span>{" "}
            of{" "}
            <span className="font-bold text-white">{filteredLogs.length}</span>{" "}
            events
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className={`px-4 py-1.5 rounded-lg border border-border-dark text-xs font-bold transition-all ${currentPage === 1 ? "text-text-secondary opacity-50 cursor-not-allowed" : "text-white hover:bg-white/5"}`}
            >
              Previous
            </button>
            <button
              onClick={() =>
                setCurrentPage((prev) => Math.min(prev + 1, totalPages))
              }
              disabled={currentPage === totalPages || totalPages === 0}
              className={`px-4 py-1.5 rounded-lg border border-border-dark text-xs font-bold transition-all ${currentPage === totalPages || totalPages === 0 ? "text-text-secondary opacity-50 cursor-not-allowed" : "text-white hover:bg-white/5"}`}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ActivityLogsSettings;
