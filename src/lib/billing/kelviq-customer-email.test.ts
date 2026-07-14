import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildKelviqCustomerEmail } from './kelviq-customer-email';

const WORKSPACE_A = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const WORKSPACE_B = 'b2c3d4e5-f6a7-4890-b123-456789abcdef';

describe('buildKelviqCustomerEmail', () => {
    it('uses plus-address when real email supports it', () => {
        const email = buildKelviqCustomerEmail('alice@corp.com', WORKSPACE_A);
        assert.equal(email, 'alice+ow-a1b2c3d4@corp.com');
    });

    it('is stable for the same workspace', () => {
        const a = buildKelviqCustomerEmail('alice@corp.com', WORKSPACE_A);
        const b = buildKelviqCustomerEmail('alice@corp.com', WORKSPACE_A);
        assert.equal(a, b);
    });

    it('differs per workspace for the same user', () => {
        const a = buildKelviqCustomerEmail('alice@corp.com', WORKSPACE_A);
        const b = buildKelviqCustomerEmail('alice@corp.com', WORKSPACE_B);
        assert.notEqual(a, b);
    });

    it('uses fallback when email has no @', () => {
        const email = buildKelviqCustomerEmail('not-an-email', WORKSPACE_A, {
            billingDomain: 'example.test',
        });
        assert.equal(
            email,
            `ow-${WORKSPACE_A}@billing.example.test`,
        );
    });

    it('uses fallback when local part already contains plus', () => {
        const email = buildKelviqCustomerEmail('alice+tag@corp.com', WORKSPACE_A, {
            billingDomain: 'example.test',
        });
        assert.equal(
            email,
            `ow-${WORKSPACE_A}@billing.example.test`,
        );
    });

    it('rejects invalid workspace id', () => {
        assert.throws(
            () => buildKelviqCustomerEmail('alice@corp.com', 'not-a-uuid'),
            /UUID/,
        );
    });
});
