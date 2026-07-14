import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    computeCliTokenLookup,
    generateCliTokenPlaintext,
    isCliTokenFormat,
    TOKEN_PREFIX,
} from './cli-token-lookup';

describe('cli-token-lookup', () => {
    it('generates ow_ prefixed tokens', () => {
        const token = generateCliTokenPlaintext();
        assert.ok(isCliTokenFormat(token));
        assert.ok(token.startsWith(TOKEN_PREFIX));
    });

    it('computeCliTokenLookup is stable for same input and pepper', () => {
        const token = `${TOKEN_PREFIX}abc123`;
        const a = computeCliTokenLookup(token, 'pepper-a');
        const b = computeCliTokenLookup(token, 'pepper-a');
        const c = computeCliTokenLookup(token, 'pepper-b');
        assert.equal(a, b);
        assert.notEqual(a, c);
        assert.equal(a.length, 64);
    });
});
