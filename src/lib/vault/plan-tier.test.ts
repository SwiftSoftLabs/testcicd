import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    planAtLeast,
    effectiveVaultPlanCode,
    shouldRevokeCliTokensAfterPlanChange,
    vaultHasMax,
    vaultHasPro,
    vaultBillingPlanMismatch,
} from './plan-tier';

describe('planAtLeast', () => {
    it('enterprise satisfies max and pro', () => {
        assert.equal(planAtLeast('enterprise', 'max'), true);
        assert.equal(planAtLeast('enterprise', 'pro'), true);
    });

    it('max satisfies max but not above enterprise', () => {
        assert.equal(planAtLeast('max', 'max'), true);
        assert.equal(planAtLeast('max', 'pro'), true);
    });

    it('pro does not satisfy max', () => {
        assert.equal(planAtLeast('pro', 'max'), false);
        assert.equal(planAtLeast('pro', 'pro'), true);
    });

    it('basic does not satisfy pro or max', () => {
        assert.equal(planAtLeast('basic', 'pro'), false);
        assert.equal(planAtLeast('basic', 'max'), false);
    });

    it('unknown plan codes are denied', () => {
        assert.equal(planAtLeast('unknown', 'pro'), false);
    });
});

describe('vaultHasPro / vaultHasMax', () => {
    it('maps tiers to feature gates', () => {
        assert.equal(vaultHasPro('enterprise'), true);
        assert.equal(vaultHasMax('enterprise'), true);
        assert.equal(vaultHasMax('pro'), false);
        assert.equal(vaultHasPro('basic'), false);
    });
});

describe('effectiveVaultPlanCode', () => {
    it('returns stored tier when subscription is paid', () => {
        assert.equal(effectiveVaultPlanCode('max', 'active'), 'max');
        assert.equal(effectiveVaultPlanCode('enterprise', 'manual'), 'enterprise');
    });

    it('returns basic when subscription is not entitled', () => {
        assert.equal(effectiveVaultPlanCode('max', 'canceled'), 'basic');
        assert.equal(effectiveVaultPlanCode('enterprise', 'past_due'), 'enterprise');
        assert.equal(effectiveVaultPlanCode('max', 'basic'), 'basic');
    });
});

describe('shouldRevokeCliTokensAfterPlanChange', () => {
    it('revokes when dropping from max+ to below max', () => {
        assert.equal(shouldRevokeCliTokensAfterPlanChange('max', 'basic'), true);
        assert.equal(shouldRevokeCliTokensAfterPlanChange('enterprise', 'pro'), true);
    });

    it('does not revoke on upgrade or unchanged max+', () => {
        assert.equal(shouldRevokeCliTokensAfterPlanChange('pro', 'max'), false);
        assert.equal(shouldRevokeCliTokensAfterPlanChange('max', 'max'), false);
        assert.equal(shouldRevokeCliTokensAfterPlanChange('basic', 'pro'), false);
        assert.equal(shouldRevokeCliTokensAfterPlanChange('pro', 'basic'), false);
    });
});

describe('vaultBillingPlanMismatch', () => {
    it('detects stored tier above effective entitlements', () => {
        assert.equal(vaultBillingPlanMismatch('enterprise', 'basic'), true);
        assert.equal(vaultBillingPlanMismatch('max', 'basic'), true);
    });

    it('returns false when tiers align', () => {
        assert.equal(vaultBillingPlanMismatch('enterprise', 'enterprise'), false);
        assert.equal(vaultBillingPlanMismatch('basic', 'basic'), false);
    });
});
