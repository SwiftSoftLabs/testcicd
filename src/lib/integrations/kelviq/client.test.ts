import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror parseKelviqCustomerResponse logic for unit coverage without exporting internals.
function parseKelviqCustomerResponse(
    data: unknown,
    externalCustomerId?: string,
): { id: string; customerId?: string } | null {
    if (!data || typeof data !== 'object') return null;

    const normalize = (row: Record<string, unknown>) => {
        if (typeof row.id !== 'string') return null;
        const customerId = typeof row.customerId === 'string'
            ? row.customerId
            : typeof row.customer_id === 'string'
                ? row.customer_id
                : undefined;
        return { id: row.id, customerId };
    };

    const pick = (rows: { id: string; customerId?: string }[]) => {
        if (externalCustomerId) {
            return rows.find((row) => row.customerId === externalCustomerId) ?? null;
        }
        return rows[0] ?? null;
    };

    if ('id' in data && typeof (data as { id: string }).id === 'string') {
        const row = normalize(data as Record<string, unknown>);
        if (!row) return null;
        if (externalCustomerId && row.customerId && row.customerId !== externalCustomerId) {
            return null;
        }
        return row;
    }

    const results = (data as { results?: unknown[] }).results;
    if (!results?.length) return null;
    const normalized = results
        .map((row) => normalize(row as Record<string, unknown>))
        .filter((row) => row !== null);
    return pick(normalized);
}

describe('parseKelviqCustomerResponse', () => {
    const workspaceId = '68fb4714-bf89-48b6-8113-723f400eef4e';

    it('picks the row matching external customerId when list is unfiltered', () => {
        const parsed = parseKelviqCustomerResponse({
            count: 25,
            results: [
                { id: 'wrong-internal-id', customerId: 'other-workspace-uuid' },
                { id: 'correct-internal-id', customerId: workspaceId },
            ],
        }, workspaceId);
        assert.equal(parsed?.id, 'correct-internal-id');
    });

    it('returns null when no row matches external customerId', () => {
        const parsed = parseKelviqCustomerResponse({
            results: [{ id: 'only-id', customerId: 'other-workspace-uuid' }],
        }, workspaceId);
        assert.equal(parsed, null);
    });
});
