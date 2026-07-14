import { WorkspaceFolder } from "@/types/files";

export interface FolderNode extends WorkspaceFolder {
  children: FolderNode[];
}

export interface BreadcrumbEntry {
  id: string | null;
  name: string;
}

export function buildFolderTree(folders: WorkspaceFolder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  for (const f of folders) {
    map.set(f.id, { ...f, children: [] });
  }

  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function getFolderPath(
  folderId: string,
  folders: WorkspaceFolder[],
): BreadcrumbEntry[] {
  const map = new Map<string, WorkspaceFolder>();
  for (const f of folders) map.set(f.id, f);

  const path: BreadcrumbEntry[] = [];
  let current: WorkspaceFolder | undefined = map.get(folderId);

  while (current) {
    path.unshift({ id: current.id, name: current.name });
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }

  return path;
}
