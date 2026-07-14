export const UNASSIGNED_ASSIGNEE_FILTER = "unassigned";

export function matchesAssigneeFilter(
  taskAssigneeId: string | null | undefined,
  filter: string,
): boolean {
  if (!filter) return true;
  if (filter === UNASSIGNED_ASSIGNEE_FILTER) return !taskAssigneeId;
  return taskAssigneeId === filter;
}
