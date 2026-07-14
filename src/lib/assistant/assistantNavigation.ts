import {
  ASSISTANT_ROUTES,
  isPathAllowed,
  type ResolvedAssistantContext,
} from "./assistantContext";

const NAV_PREFIX =
  /^(?:go\s+to|open|show|navigate\s+to|take\s+me\s+to|switch\s+to)\s+(.+)$/i;

const NAV_INTENT =
  /\b(go\s+to|open|show|navigate\s+to|take\s+me\s+to|switch\s+to)\b/i;

type NavigationTarget = {
  path: string;
  phrases: string[];
};

function cleanPhrase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+page$/i, "")
    .replace(/\s+please$/i, "")
    .replace(/\s+settings$/i, "")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0),
  );

  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function settingsExtraPhrases(path: string, label: string): string[] {
  if (!path.startsWith("/settings/")) return [];
  const slug = path.replace("/settings/", "");
  const slugSpaced = slug.replace(/-/g, " ");
  return [
    slug,
    slugSpaced,
    `${slug} settings`,
    `${slugSpaced} settings`,
    `open ${slug}`,
    `go to ${slug}`,
    `open ${slugSpaced}`,
    `go to ${slugSpaced}`,
    label.toLowerCase(),
  ].map(cleanPhrase);
}

/** Build navigation targets from routes the user is allowed to access. */
export function buildNavigationTargets(
  ctx: ResolvedAssistantContext,
): NavigationTarget[] {
  const targets: NavigationTarget[] = [];

  for (const route of ASSISTANT_ROUTES) {
    if (!isPathAllowed(ctx, route.path)) continue;

    const slug = route.path.replace(/^\//, "");
    const slugSpaced = slug.replace(/-/g, " ");
    const phrases = new Set(
      [
        route.label.toLowerCase(),
        route.module,
        slug,
        slugSpaced,
        `open ${route.label.toLowerCase()}`,
        `go to ${route.label.toLowerCase()}`,
        `open ${slugSpaced}`,
        `go to ${slugSpaced}`,
        `open ${slug}`,
        `go to ${slug}`,
        ...settingsExtraPhrases(route.path, route.label),
        route.path === "/notifications"
          ? ["alerts", "notifications", "my notifications"]
          : [],
      ]
        .flat()
        .map(cleanPhrase),
    );

    targets.push({ path: route.path, phrases: [...phrases] });
  }

  return targets;
}

export function formatNavigationHints(ctx: ResolvedAssistantContext): string[] {
  return buildNavigationTargets(ctx).map((target) => {
    const route = ASSISTANT_ROUTES.find((r) => r.path === target.path);
    return route?.label ?? target.path;
  });
}

function resolveTargetPhrase(
  phrase: string,
  targets: NavigationTarget[],
): string | null {
  const cleaned = cleanPhrase(phrase);
  if (!cleaned) return null;

  for (const target of targets) {
    if (target.phrases.includes(cleaned)) return target.path;
  }

  let bestPath: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    for (const candidate of target.phrases) {
      const dist = levenshtein(cleaned, candidate);
      const maxLen = Math.max(cleaned.length, candidate.length);
      if (maxLen < 4) continue;
      const threshold = maxLen >= 8 ? 2 : 1;
      if (dist <= threshold && dist < bestDistance) {
        bestDistance = dist;
        bestPath = target.path;
      }
    }
  }

  return bestPath;
}

function tryLooseNavigation(
  transcript: string,
  targets: NavigationTarget[],
): string | null {
  const lower = cleanPhrase(transcript);
  if (!lower || !NAV_INTENT.test(lower)) return null;

  for (const target of targets) {
    for (const phrase of target.phrases) {
      if (phrase.length < 4) continue;
      if (lower.includes(phrase)) return target.path;
    }
  }

  return null;
}

export function normalizeVoiceCommandText(transcript: string): string {
  return transcript.trim().replace(/\s+/g, " ");
}

/**
 * Deterministic navigation — matches only against this user's allowed routes.
 */
export function tryResolveNavigation(
  transcript: string,
  ctx: ResolvedAssistantContext,
): string | null {
  const normalized = normalizeVoiceCommandText(transcript);
  const lower = normalized.toLowerCase();
  const targets = buildNavigationTargets(ctx);

  const prefixed = lower.match(NAV_PREFIX);
  if (prefixed) {
    const path = resolveTargetPhrase(prefixed[1], targets);
    if (path) return path;
  }

  const loose = tryLooseNavigation(lower, targets);
  if (loose) return loose;

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return resolveTargetPhrase(lower, targets);
  }

  return null;
}

function matchesStaticRoutePhrase(phrase: string): boolean {
  const cleaned = cleanPhrase(phrase);
  if (!cleaned) return false;

  for (const route of ASSISTANT_ROUTES) {
    const slug = route.path.replace(/^\//, "");
    const slugSpaced = slug.replace(/-/g, " ");
    const candidates = [
      route.label.toLowerCase(),
      route.module,
      slug,
      slugSpaced,
      ...settingsExtraPhrases(route.path, route.label),
    ].map(cleanPhrase);
    if (candidates.includes(cleaned)) return true;
  }

  return false;
}

const CONVERSATIONAL_PATTERN =
  /^(?:hi|hello|hey|howdy|yo|sup|what'?s\s+up|how\s+are\s+you|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|yes|no|ok|okay|cool|nice|bye|goodbye)(?:\s|$|[!.?])/i;

function hasExplicitActionIntent(transcript: string): boolean {
  return (
    looksLikeNavigationCommand(transcript) ||
    looksLikeCreateTaskCommand(transcript) ||
    looksLikeNewMessageCommand(transcript) ||
    looksLikeEmailComposeCommand(transcript) ||
    looksLikeSummarizeCommand(transcript) ||
    looksLikeQuickPrCommand(transcript) ||
    looksLikeSearchCommand(transcript) ||
    looksLikeSwitchWorkspaceCommand(transcript) ||
    looksLikeSwitchProjectCommand(transcript) ||
    looksLikeFilterTasksCommand(transcript) ||
    looksLikeDraftChatReplyCommand(transcript) ||
    looksLikeDraftEmailReplyCommand(transcript) ||
    looksLikeStartCallCommand(transcript) ||
    looksLikeCreateEventCommand(transcript) ||
    looksLikeUpdateTaskCommand(transcript) ||
    looksLikeBulkUpdateTasksCommand(transcript) ||
    looksLikeSendEmailCommand(transcript) ||
    matchesStaticRoutePhrase(transcript)
  );
}

export function looksLikeConversationalInput(transcript: string): boolean {
  const normalized = normalizeVoiceCommandText(transcript).toLowerCase();
  if (CONVERSATIONAL_PATTERN.test(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && !NAV_INTENT.test(normalized) && !NAV_PREFIX.test(normalized)) {
    if (!hasExplicitActionIntent(normalized) && words.every((w) => w.length <= 5)) {
      return true;
    }
  }
  return false;
}

export function looksLikeNavigationCommand(transcript: string): boolean {
  const normalized = normalizeVoiceCommandText(transcript).toLowerCase();
  if (looksLikeQuickPrCommand(normalized)) return false;
  if (looksLikeSearchCommand(normalized)) return false;
  if (looksLikeSwitchWorkspaceCommand(normalized)) return false;
  if (looksLikeSwitchProjectCommand(normalized)) return false;
  if (NAV_PREFIX.test(normalized)) return true;
  if (NAV_INTENT.test(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return matchesStaticRoutePhrase(words[0]);
  }
  return false;
}

export function looksLikeCreateTaskCommand(transcript: string): boolean {
  return (
    /\b(create|add|make|new)\s+(a\s+)?task\b/i.test(transcript) ||
    /\b(task)\s+(for|about|to)\b/i.test(transcript)
  );
}

export function looksLikeNewMessageCommand(transcript: string): boolean {
  return /\b(new|send|start)\s+(a\s+)?(message|chat)\b/i.test(transcript);
}

export function looksLikeEmailComposeCommand(transcript: string): boolean {
  if (looksLikeSendEmailCommand(transcript)) return false;
  return (
    /\b(compose|write|draft)\s+(an?\s+)?email\b/i.test(transcript) ||
    /\bemail\s+compose\b/i.test(transcript)
  );
}

export function looksLikeSummarizeCommand(transcript: string): boolean {
  return (
    /\b(summarize|summary|summarise|catch\s+me\s+up|digest|overview)\b/i.test(
      transcript,
    ) ||
    /\bwhat'?s\s+on\s+(my\s+)?(calendar|schedule)\b/i.test(transcript) ||
    /\bsummarize\s+(this\s+)?email\s+thread\b/i.test(transcript)
  );
}

export function looksLikeQuickPrCommand(transcript: string): boolean {
  return (
    /\b(new|create|open)\s+(a\s+)?(pull\s+request|pr)\b/i.test(transcript) ||
    /\bquick\s+pr\b/i.test(transcript)
  );
}

export function looksLikeSearchCommand(transcript: string): boolean {
  return (
    /^(?:search|find)\s+(?:for\s+)?(.+)/i.test(transcript) ||
    /\bsearch\s+for\b/i.test(transcript)
  );
}

export function looksLikeSwitchWorkspaceCommand(transcript: string): boolean {
  return /\b(?:switch|change)\s+(?:to\s+)?(?:the\s+)?workspace\b/i.test(
    transcript,
  );
}

export function looksLikeSwitchProjectCommand(transcript: string): boolean {
  return /\b(?:switch|change)\s+(?:to\s+)?(?:the\s+)?project\b/i.test(
    transcript,
  );
}

export function looksLikeFilterTasksCommand(transcript: string): boolean {
  return (
    /\b(filter|show)\s+(?:my\s+)?tasks\b/i.test(transcript) ||
    /\b(show|list)\s+(?:blocked|urgent|high|low)\s+tasks\b/i.test(transcript) ||
    /\btasks?\s+(?:that\s+are|with|assigned)\b/i.test(transcript)
  );
}

export function looksLikeDraftChatReplyCommand(transcript: string): boolean {
  return (
    /\b(suggest|draft)\s+(a\s+)?reply\b/i.test(transcript) ||
    /\bdraft\s+(a\s+)?message\b/i.test(transcript) ||
    /\bsuggest\s+(a\s+)?response\b/i.test(transcript)
  );
}

export function looksLikeDraftEmailReplyCommand(transcript: string): boolean {
  return (
    /\b(draft|write)\s+(a\s+)?reply\b/i.test(transcript) ||
    /\breply\s+to\s+(this\s+)?email\b/i.test(transcript)
  );
}

export function looksLikeStartCallCommand(transcript: string): boolean {
  return (
    /\b(start|begin|join)\s+(a\s+)?(video\s+)?call\b/i.test(transcript) ||
    /\bvideo\s+call\s+with\b/i.test(transcript) ||
    /\bcall\s+with\b/i.test(transcript)
  );
}

export function looksLikeCreateEventCommand(transcript: string): boolean {
  return (
    /\b(schedule|create|add)\s+(a\s+)?(meeting|event|calendar\s+event)\b/i.test(
      transcript,
    ) ||
    /\bbook\s+(a\s+)?meeting\b/i.test(transcript)
  );
}

export function looksLikeUpdateTaskCommand(transcript: string): boolean {
  const hasTaskKey = /\b[A-Z][A-Z0-9]+-\d+\b/.test(transcript);
  const hasMoveVerb = /\b(move|change|set|mark|complete|finish|assign|update)\b/i.test(
    transcript,
  );
  return (
    /\b(mark|complete|finish)\s+.+\s+(done|complete)\b/i.test(transcript) ||
    /\bassign\s+.+\s+to\b/i.test(transcript) ||
    /\bset\s+(status|priority)\s+of\b/i.test(transcript) ||
    /\bupdate\s+task\b/i.test(transcript) ||
    /\bmove\s+.+\s+to\s+(backlog|todo|review|done|in\s+progress)\b/i.test(
      transcript,
    ) ||
    /\bmove\s+(this\s+)?task\s+to\b/i.test(transcript) ||
    /\bmove\s+.+\s+to\s+(the\s+)?(\w+\s+)?project\b/i.test(transcript) ||
    (hasTaskKey && hasMoveVerb)
  );
}

export function looksLikeBulkUpdateTasksCommand(transcript: string): boolean {
  return (
    /\b(all|every)\s+.+\s+tasks?\b/i.test(transcript) ||
    /\bmove\s+all\b/i.test(transcript) ||
    /\bupdate\s+all\b/i.test(transcript) ||
    /\bbulk\s+(update|move)\b/i.test(transcript) ||
    /\b(all|every)\s+tasks?\s+in\s+(backlog|todo|review|done|in\s+progress)\b/i.test(
      transcript,
    )
  );
}

export function looksLikeSendEmailCommand(transcript: string): boolean {
  return (
    /\bsend\s+(the\s+)?email\b/i.test(transcript) ||
    /\bsend\s+it\b/i.test(transcript)
  );
}

/** Commands only run tools when intent is explicit — avoids LLM inventing actions. */
export function getExplicitToolAllowlist(transcript: string): string[] {
  if (looksLikeConversationalInput(transcript)) {
    return [];
  }

  const allowed: string[] = [];

  if (looksLikeNavigationCommand(transcript)) {
    allowed.push("navigate");
  }
  if (looksLikeSummarizeCommand(transcript)) {
    allowed.push("summarize_context");
    if (/\bemail\s+thread\b/i.test(transcript)) {
      allowed.push("summarize_email_thread");
    }
    if (/\bcalendar|schedule\b/i.test(transcript)) {
      allowed.push("summarize_context");
    }
  }
  if (looksLikeCreateTaskCommand(transcript)) {
    allowed.push("create_task_draft", "open_modal");
  }
  if (looksLikeNewMessageCommand(transcript)) {
    allowed.push("open_modal");
  }
  if (looksLikeEmailComposeCommand(transcript)) {
    allowed.push("open_email_compose");
  }
  if (looksLikeQuickPrCommand(transcript)) {
    allowed.push("open_quick_pr", "navigate");
  }
  if (looksLikeSearchCommand(transcript)) {
    allowed.push("open_global_search");
  }
  if (looksLikeSwitchWorkspaceCommand(transcript)) {
    allowed.push("switch_workspace");
  }
  if (looksLikeSwitchProjectCommand(transcript)) {
    allowed.push("switch_project");
  }
  if (looksLikeFilterTasksCommand(transcript)) {
    allowed.push("filter_tasks", "navigate");
  }
  if (looksLikeDraftChatReplyCommand(transcript)) {
    allowed.push("draft_chat_reply");
  }
  if (looksLikeDraftEmailReplyCommand(transcript)) {
    allowed.push("draft_email_reply");
  }
  if (looksLikeStartCallCommand(transcript)) {
    allowed.push("start_call");
  }
  if (looksLikeCreateEventCommand(transcript)) {
    allowed.push("create_calendar_event", "open_modal");
  }
  if (looksLikeBulkUpdateTasksCommand(transcript)) {
    allowed.push("bulk_update_tasks");
  }
  if (looksLikeUpdateTaskCommand(transcript)) {
    allowed.push("update_task");
  }
  if (looksLikeSendEmailCommand(transcript)) {
    allowed.push("send_email");
  }

  return [...new Set(allowed)];
}
