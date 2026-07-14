const TASKS_PATH = "/tasks";

export function buildTaskDeepLink(
  taskId: string,
  projectId?: string | null,
  opts?: { absolute?: boolean },
): string {
  const params = new URLSearchParams();
  params.set("open", taskId);
  if (projectId) params.set("projectId", projectId);

  const relative = `${TASKS_PATH}?${params.toString()}`;

  if (!opts?.absolute) return relative;

  const base =
    (typeof window !== "undefined" ? window.location.origin : undefined) ??
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "";

  return base ? `${base}${relative}` : relative;
}

export function parseTaskDeepLink(searchParams: URLSearchParams): {
  taskId: string | null;
  projectId: string | null;
} {
  return {
    taskId: searchParams.get("open"),
    projectId: searchParams.get("projectId"),
  };
}
