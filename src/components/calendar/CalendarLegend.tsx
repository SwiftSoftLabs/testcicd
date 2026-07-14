"use client";

import React from 'react';
import { EmailIcon, FolderIcon, GlobeIcon, PersonIcon, PluginIcon, TaskIcon } from '@/components/calendar/CalendarIcons';

export type FilterKey =
  | 'myEvents'
  | 'workspaceEvents'
  | 'projectEvents'
  | 'emailEvents'
  | 'pluginEvents'
  | 'tasks';

interface CalendarLegendProps {
  filters: Record<FilterKey, boolean>;
  onChange: (key: FilterKey) => void;
  counts: Record<FilterKey, number>;
}

interface LegendItemConfig {
  key: FilterKey;
  label: string;
  activeClasses: string;
  icon: React.ReactNode;
}

/** Kelviq-style: flat pastel fill + saturated label (no heavy borders). */
const LEGEND_ITEMS: LegendItemConfig[] = [
  {
    key: 'myEvents',
    label: 'Private',
    activeClasses:
      'light:bg-amber-50 light:text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
    icon: <PersonIcon size={14} />,
  },
  {
    key: 'workspaceEvents',
    label: 'Workspace',
    activeClasses:
      'light:bg-blue-50 light:text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
    icon: <GlobeIcon size={14} />,
  },
  {
    key: 'projectEvents',
    label: 'Project',
    activeClasses:
      'light:bg-indigo-50 light:text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200',
    icon: <FolderIcon size={14} />,
  },
  {
    key: 'emailEvents',
    label: 'Email',
    activeClasses:
      'light:bg-cyan-50 light:text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200',
    icon: <EmailIcon size={14} />,
  },
  {
    key: 'pluginEvents',
    label: 'Plugin',
    activeClasses:
      'light:bg-violet-50 light:text-violet-700 dark:bg-violet-500/15 dark:text-violet-200',
    icon: <PluginIcon size={14} />,
  },
  {
    key: 'tasks',
    label: 'Tasks',
    activeClasses:
      'light:bg-emerald-50 light:text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
    icon: <TaskIcon size={14} />,
  },
];

const CHIP_BASE =
  'flex cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-xs font-semibold transition-colors';

const INACTIVE_CLASSES =
  'light:bg-slate-100 light:text-slate-600 light:hover:bg-slate-200/80 light:hover:text-slate-800 dark:bg-surface-dark/60 dark:text-slate-400 dark:hover:bg-surface-dark dark:hover:text-slate-200';

export function CalendarLegend({
  filters,
  onChange,
  counts,
}: CalendarLegendProps) {
  return (
    <div className="flex flex-nowrap items-center gap-1.5 w-max">
      {LEGEND_ITEMS.map((item) => {
        const isActive = filters[item.key];
        const stateClasses = isActive ? item.activeClasses : INACTIVE_CLASSES;

        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`${CHIP_BASE} ${stateClasses}`}
            aria-pressed={isActive}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:stroke-[2]">
              {item.icon}
            </span>
            <span>{item.label}</span>
            <span className="tabular-nums text-[11px] font-semibold opacity-80">
              {counts[item.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
