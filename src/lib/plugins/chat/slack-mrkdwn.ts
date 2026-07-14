import { fetchSlackUserDisplayName } from './slack';

const SLACK_USER_MENTION = /<@([A-Z0-9]+)(?:\|([^>]+))?>/gi;
const PLAIN_SLACK_USER_MENTION = /@([UWBS][A-Z0-9]{8,})\b/g;
const SLACK_SPECIAL_MENTION = /<!(here|channel|everyone)(?:\|([^>]+))?>/gi;
const SLACK_CHANNEL = /<#([A-Z0-9]+)(?:\|([^>]+))?>/gi;

export type SlackMentionLabels = Record<string, string>;

/** True when string looks like a Slack member ID, not a resolved display name. */
export function isSlackMemberId(value: string): boolean {
    return /^[UWBS][A-Z0-9]{8,}$/i.test(value.trim());
}

function collectSlackUserIds(text: string): string[] {
    const ids = new Set<string>();
    for (const match of text.matchAll(SLACK_USER_MENTION)) {
        if (match[1]) ids.add(match[1].toUpperCase());
    }
    for (const match of text.matchAll(new RegExp(PLAIN_SLACK_USER_MENTION.source, 'gi'))) {
        if (match[1]) ids.add(match[1].toUpperCase());
    }
    return [...ids];
}

function formatAtMention(displayName: string): string {
    return `@${displayName.trim()}`;
}

function resolveMentionDisplay(
    id: string,
    label: string | undefined,
    mentionLabels: SlackMentionLabels,
): string | null {
    const fromLabel = label?.trim();
    if (fromLabel && !isSlackMemberId(fromLabel)) return formatAtMention(fromLabel);

    const fromMap = mentionLabels[id]?.trim();
    if (fromMap && !isSlackMemberId(fromMap)) return formatAtMention(fromMap);

    return null;
}

async function ensureMentionLabels(
    text: string,
    token: string,
    cache: Map<string, string>,
): Promise<SlackMentionLabels> {
    const labels: SlackMentionLabels = {};
    for (const id of collectSlackUserIds(text)) {
        if (cache.has(id)) {
            const cached = cache.get(id)!;
            if (!isSlackMemberId(cached)) labels[id] = cached;
            continue;
        }
        const name = await fetchSlackUserDisplayName(token, id);
        const resolved = name?.trim();
        if (resolved && !isSlackMemberId(resolved)) {
            cache.set(id, resolved);
            labels[id] = resolved;
        }
    }
    return labels;
}

/** Replace Slack mrkdwn tokens with display-friendly text; returns labels for UI fallback. */
export async function resolveSlackMrkdwnForStorage(
    raw: string,
    token: string,
    cache: Map<string, string>,
): Promise<{ text: string; mentionLabels: SlackMentionLabels }> {
    if (!raw) return { text: '', mentionLabels: {} };

    const mentionLabels = await ensureMentionLabels(raw, token, cache);

    let text = raw;
    text = text.replace(SLACK_USER_MENTION, (match, id: string, label?: string) => {
        const normalizedId = id.toUpperCase();
        return resolveMentionDisplay(normalizedId, label, mentionLabels) ?? match;
    });
    text = text.replace(
        new RegExp(PLAIN_SLACK_USER_MENTION.source, 'gi'),
        (match, id: string) => {
            const normalizedId = id.toUpperCase();
            return resolveMentionDisplay(normalizedId, undefined, mentionLabels) ?? match;
        },
    );
    text = text.replace(SLACK_SPECIAL_MENTION, (_m, kind: string) => `@${kind}`);
    text = text.replace(SLACK_CHANNEL, (_m, _id: string, label?: string) =>
        label?.trim() ? `#${label.trim()}` : '#channel',
    );

    return { text, mentionLabels };
}

/** Apply stored labels to bracketed or plain @memberId mentions (no API). */
export function applySlackMentionLabels(
    raw: string,
    mentionLabels?: SlackMentionLabels | null,
): string {
    if (!raw || !mentionLabels || Object.keys(mentionLabels).length === 0) return raw;

    let text = raw;
    text = text.replace(SLACK_USER_MENTION, (match, id: string, label?: string) => {
        const normalizedId = id.toUpperCase();
        return resolveMentionDisplay(normalizedId, label, mentionLabels) ?? match;
    });
    text = text.replace(
        new RegExp(PLAIN_SLACK_USER_MENTION.source, 'gi'),
        (match, id: string) => {
            const normalizedId = id.toUpperCase();
            return resolveMentionDisplay(normalizedId, undefined, mentionLabels) ?? match;
        },
    );
    return text;
}

export function slackMessageNeedsMentionResolution(content: string): boolean {
    if (/<@[A-Z0-9]+>/i.test(content)) return true;
    for (const match of content.matchAll(new RegExp(PLAIN_SLACK_USER_MENTION.source, 'gi'))) {
        if (match[1] && isSlackMemberId(match[1])) return true;
    }
    return false;
}
