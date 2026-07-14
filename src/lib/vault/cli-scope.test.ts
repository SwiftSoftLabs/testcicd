import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    isEnvironmentAllowedByToken,
    normalizeAllowedEnvironments,
    tokenHasVaultReadScope,
    VAULT_CLI_READ_SCOPE,
} from './cli-scope';

describe('tokenHasVaultReadScope', () => {
    it('requires vault:read', () => {
        assert.equal(tokenHasVaultReadScope([VAULT_CLI_READ_SCOPE]), true);
        assert.equal(tokenHasVaultReadScope(['other']), false);
    });
});

describe('isEnvironmentAllowedByToken', () => {
    it('allows all when allowlist empty or null', () => {
        assert.equal(isEnvironmentAllowedByToken(null, 'production'), true);
        assert.equal(isEnvironmentAllowedByToken([], 'development'), true);
    });

    it('matches case-insensitively', () => {
        assert.equal(isEnvironmentAllowedByToken(['Development'], 'development'), true);
        assert.equal(isEnvironmentAllowedByToken(['production'], 'development'), false);
    });
});

describe('normalizeAllowedEnvironments', () => {
    it('dedupes and trims', () => {
        assert.deepEqual(normalizeAllowedEnvironments([' dev ', 'Dev', 'preview']), ['dev', 'preview']);
    });
});
