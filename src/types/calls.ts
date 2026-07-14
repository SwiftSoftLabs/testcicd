export type RecordingRetention =
  | "forever"
  | "7_days"
  | "30_days"
  | "sprint_end";

export type CallSessionStatus =
  | "scheduled"
  | "lobby"
  | "live"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type CallSessionType = "instant_1_1" | "instant_group" | "scheduled";

export type CallParticipantRole = "host" | "cohost" | "participant";

export type CallRecordingStatus = "recording" | "uploaded" | "failed";

export type CallTranscriptStatus = "processing" | "ready" | "failed";

export type CallAiArtifactStatus =
  | "processing"
  | "ready"
  | "failed"
  | "skipped";

export type MeetingReviewStatus =
  | "pending"
  | "acknowledged"
  | "approved"
  | "rejected";

export interface TranscriptSegment {
  speaker_user_id: string | null;
  text: string;
  start_ms: number;
  end_ms: number;
  confidence?: number;
  /** LiveKit participant identity (typically user UUID). */
  participant_identity?: string | null;
  is_final?: boolean;
  sentence_id?: number | null;
}

/** Host-side interim caption before the next /live poll. */
export interface LiveSttCaption {
  text: string;
  isFinal: boolean;
  startMs: number;
  sentenceId: number | null;
}

export interface LiveNote {
  at_ms: number;
  text: string;
}

export interface CallMeetingNotesPayload {
  publicContent: string;
  privateContent: string;
  publicUpdatedAt: string | null;
  publicUpdatedBy: string | null;
}

export interface CallNotesUpdatePayload {
  publicContent: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CallLivePayload {
  transcript: {
    id: string;
    full_text: string | null;
    segments: TranscriptSegment[];
    status: CallTranscriptStatus;
  } | null;
  artifact: {
    id: string;
    summary: string | null;
    key_decisions: string[];
    live_notes: LiveNote[];
    status: CallAiArtifactStatus;
  } | null;
  reviews: MeetingTaskReviewRow[];
  stt_status?: {
    envEnabled: boolean;
    agentDispatchId: string | null;
    error: string | null;
    aiEnabled: boolean;
  };
  ai_status?: {
    geminiConfigured: boolean;
    artifactStatus: CallAiArtifactStatus | null;
    pendingTaskCount: number;
    lastAiRunAt: string | null;
    liveAiRunning: boolean;
    tasksPipelineStage: "idle" | "hearing" | "compiling" | "creating" | "ready";
  };
}

export interface CallSessionRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  conversation_id: string | null;
  calendar_event_id: string | null;
  created_by: string;
  title: string;
  type: CallSessionType;
  status: CallSessionStatus;
  livekit_room_name: string | null;
  livekit_agent_dispatch_id: string | null;
  ai_mode: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  recording_enabled: boolean;
  ai_enabled: boolean;
  /** Post-call: processing_progress (0–100), processing_phase, processing_step_label */
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CallParticipantRow {
  id: string;
  call_session_id: string;
  user_id: string;
  role: CallParticipantRole;
  livekit_identity: string | null;
  joined_at: string | null;
  left_at: string | null;
  consent_at: string | null;
  created_at: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

/** Lightweight call state for in-room sync (no recording/transcript/AI artifact). */
export interface CallSyncPayload {
  id: string;
  status: CallSessionStatus;
  metadata: Record<string, unknown>;
  ai_enabled: boolean;
  participants: CallParticipantRow[];
}

export interface CallSessionDetail extends CallSessionRow {
  participants: CallParticipantRow[];
  recording?: {
    id: string;
    playback_url: string | null;
    duration_seconds: number | null;
    status: CallRecordingStatus;
  } | null;
  transcript?: {
    id: string;
    full_text: string | null;
    segments: TranscriptSegment[];
    status: CallTranscriptStatus;
  } | null;
  ai_artifact?: {
    id: string;
    summary: string | null;
    key_decisions: string[];
    live_notes: unknown[];
    status: CallAiArtifactStatus;
  } | null;
  pending_review_count?: number;
}

export interface MeetingTaskReviewRow {
  id: string;
  call_session_id: string;
  task_id: string;
  review_status: MeetingReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  ai_confidence: number | null;
  created_at: string;
  task?: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    tags: string[];
    assignee_id: string | null;
  };
  call?: {
    id: string;
    title: string;
    started_at: string | null;
  };
}
