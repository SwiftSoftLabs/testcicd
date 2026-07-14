export interface WorkspaceFolder {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceFile {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  file_name: string;
  file_size: number;
  file_type: string;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
}

export interface FilesListResponse {
  folders: WorkspaceFolder[];
  files: WorkspaceFile[];
  storage_used: number;
  storage_limit: number;
}

export type ViewMode = "list" | "icon" | "details";
export type SortField = "name" | "date" | "size" | "type";
export type SortOrder = "asc" | "desc";
