/** How far back channel history sync pulls messages (all chat providers). */
export function chatPluginHistoryDays(): number {
    const raw = parseInt(process.env.CHAT_PLUGIN_HISTORY_DAYS?.trim() || '30', 10);
    if (!Number.isFinite(raw) || raw < 1) return 30;
    return Math.min(raw, 90);
}

/** Slack `oldest` param (Unix seconds). */
export function chatPluginHistoryOldestUnix(): string {
    const days = chatPluginHistoryDays();
    return String(Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000));
}

export function chatPluginHistoryOldestMs(): number {
    return parseFloat(chatPluginHistoryOldestUnix()) * 1000;
}

/** Cap API pages per channel per sync to avoid runaway rate limits. */
export function chatPluginHistoryMaxPages(): number {
    const raw = parseInt(process.env.CHAT_PLUGIN_HISTORY_MAX_PAGES?.trim() || '50', 10);
    if (!Number.isFinite(raw) || raw < 1) return 50;
    return Math.min(raw, 200);
}
