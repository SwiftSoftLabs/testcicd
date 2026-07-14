export interface FormattedDate {
  label: string;
  isOverdue: boolean;
  daysUntil: number;
}

export const formatDueDate = (dueDate: string): FormattedDate => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");

  if (isNaN(due.getTime()))
    return { label: dueDate, isOverdue: false, daysUntil: 0 };

  const diffMs = due.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    return {
      label: abs === 1 ? "Overdue · 1d ago" : `Overdue · ${abs}d ago`,
      isOverdue: true,
      daysUntil: diffDays,
    };
  }
  if (diffDays === 0)
    return { label: "Due today", isOverdue: false, daysUntil: 0 };
  if (diffDays === 1)
    return { label: "Tomorrow", isOverdue: false, daysUntil: 1 };
  if (diffDays <= 6)
    return { label: `${diffDays} days`, isOverdue: false, daysUntil: diffDays };
  return {
    label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    isOverdue: false,
    daysUntil: diffDays,
  };
};

export const getTodayISO = (): string => new Date().toISOString().split("T")[0];
