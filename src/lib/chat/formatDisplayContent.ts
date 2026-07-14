/**
 * Normalizes external chat markup (Slack, Discord, etc.) into GitHub-flavored
 * markdown safe for ReactMarkdown — avoids raw `<@U…>` / `<!here>` being parsed as HTML.
 */

import { isSlackMemberId } from '@/lib/plugins/chat/slack-mrkdwn';

const SLACK_USER_MENTION = /<@([A-Z0-9]+)(?:\|([^>]+))?>/gi;
const SLACK_USER_MENTION_SPACED = /<\s*@([A-Z0-9]+)(?:\|([^>]+))?\s*>/gi;
const PLAIN_SLACK_USER_MENTION = /@([UWBS][A-Z0-9]{8,})\b/g;
const SLACK_SPECIAL_MENTION = /<!(here|channel|everyone)(?:\|([^>]+))?>/gi;
const SLACK_CHANNEL = /<#([A-Z0-9]+)(?:\|([^>]+))?>/gi;
const SLACK_LINK = /<((?:https?|mailto):[^|>]+)\|([^>]+)>/gi;
const SLACK_BARE_LINK = /<((?:https?|mailto):[^>]+)>/gi;
const DISCORD_USER = /<@!?\d+>/gi;
const DISCORD_CHANNEL = /<#\d+>/gi;

const INLINE_CODE = /`([^`\n]+)`/g;
const FENCED_CODE = /```[\s\S]*?```/g;

function hasSlackStyleMarkup(text: string): boolean {
    return /<@[A-Z0-9]|<\s*@|<![a-z]|<#[A-Z0-9]|<#\d/i.test(text);
}

/** Protect backtick regions before mrkdwn bold/italic transforms. */
function protectCodeSegments(text: string): { text: string; restore: (s: string) => string } {
    const stored: string[] = [];
    let out = text;
    out = out.replace(FENCED_CODE, (match) => {
        const i = stored.length;
        stored.push(match);
        return `\uE000F${i}\uE000`;
    });
    out = out.replace(INLINE_CODE, (match) => {
        const i = stored.length;
        stored.push(match);
        return `\uE000I${i}\uE000`;
    });
    return {
        text: out,
        restore: (s) => {
            let r = s;
            r = r.replace(/\uE000F(\d+)\uE000/g, (_, idx) => stored[Number(idx)] ?? '');
            r = r.replace(/\uE000I(\d+)\uE000/g, (_, idx) => stored[Number(idx)] ?? '');
            return r;
        },
    };
}

/** Slack mrkdwn → GFM when content looks like Slack, without breaking existing `**bold**`. */
function slackMrkdwnToMarkdown(text: string): string {
    if (!hasSlackStyleMarkup(text) && !/\*[^*\n]+\*/.test(text) && !/_[^_\n]+_/.test(text)) {
        return text;
    }

    const { text: protectedText, restore } = protectCodeSegments(text);
    let out = protectedText;

    out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '**$1**');
    out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '*$1*');
    out = out.replace(/~([^~\n]+)~/g, '~~$1~~');

    return restore(out);
}

export type MentionLabels = Record<string, string>;

function resolveSlackUserMention(
    id: string,
    label: string | undefined,
    mentionLabels?: MentionLabels | null,
): string | null {
    const normalizedId = id.toUpperCase();
    const fromLabel = label?.trim();
    const resolved =
        (fromLabel && !isSlackMemberId(fromLabel) ? fromLabel : null) ||
        mentionLabels?.[normalizedId]?.trim() ||
        mentionLabels?.[id]?.trim();
    if (resolved && !isSlackMemberId(resolved)) return `@${resolved}`;
    return null;
}

export function normalizeExternalChatMarkup(
    raw: string,
    mentionLabels?: MentionLabels | null,
): string {
    if (!raw) return '';

    let text = raw;

    text = text.replace(SLACK_LINK, '[$2]($1)');
    text = text.replace(SLACK_BARE_LINK, '$1');

    const replaceUser = (_m: string, id: string, label?: string) =>
        resolveSlackUserMention(id, label, mentionLabels) ?? _m;

    text = text.replace(SLACK_USER_MENTION_SPACED, replaceUser);
    text = text.replace(SLACK_USER_MENTION, replaceUser);
    text = text.replace(
        new RegExp(PLAIN_SLACK_USER_MENTION.source, 'gi'),
        (match, id: string) => resolveSlackUserMention(id, undefined, mentionLabels) ?? match,
    );
    text = text.replace(SLACK_SPECIAL_MENTION, (_m, kind) => `@${kind}`);
    text = text.replace(SLACK_CHANNEL, (_m, _id, label) => (label ? `#${label}` : '#channel'));
    text = text.replace(DISCORD_USER, '@user');
    text = text.replace(DISCORD_CHANNEL, '#channel');

    text = slackMrkdwnToMarkdown(text);

    return text;
}

export function prepareMessageForMarkdown(
    raw: string,
    mentionLabels?: MentionLabels | null,
): string {
    return normalizeExternalChatMarkup(raw, mentionLabels);
}

export function truncateForQuote(text: string, maxLen = 120): string {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= maxLen) return singleLine;
    return `${singleLine.slice(0, maxLen)}…`;
}

/** Relative time for thread bars (Slack-style). */
export function formatRelativeTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
