/** Human-readable storage size for UI and error messages. */
export function formatStorageBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
        const gb = bytes / (1024 * 1024 * 1024);
        return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
    }
    if (bytes >= 1024 * 1024) {
        const mb = bytes / (1024 * 1024);
        return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
        const kb = bytes / 1024;
        return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
    }
    return `${bytes} B`;
}
