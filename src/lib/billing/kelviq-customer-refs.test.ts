import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    getKelviqApiCustomerId,
    getKelviqExternalCustomerId,
    isExternalKelviqCustomerRef,
} from './kelviq-customer-id-helpers';

const WORKSPACE_ID = 'c83c73e9-7a66-426c-b9ed-54f9fb44bba8';
const INTERNAL_ID = '9d50b0e5-a3a8-4041-9d04-eeede04f2225';

describe('isExternalKelviqCustomerRef', () => {
    it('true when kelviq_customer_id equals workspace_id', () => {
        assert.equal(isExternalKelviqCustomerRef(WORKSPACE_ID, WORKSPACE_ID), true);
    });

    it('false for legacy internal id in kelviq_customer_id', () => {
        assert.equal(isExternalKelviqCustomerRef(INTERNAL_ID, WORKSPACE_ID), false);
    });
});

describe('getKelviqApiCustomerId', () => {
    it('prefers internal id column', () => {
        assert.equal(
            getKelviqApiCustomerId({
                workspace_id: WORKSPACE_ID,
                kelviq_customer_id: WORKSPACE_ID,
                kelviq_customer_internal_id: INTERNAL_ID,
            }),
            INTERNAL_ID,
        );
    });

    it('falls back to legacy internal stored in kelviq_customer_id', () => {
        assert.equal(
            getKelviqApiCustomerId({
                workspace_id: WORKSPACE_ID,
                kelviq_customer_id: INTERNAL_ID,
                kelviq_customer_internal_id: null,
            }),
            INTERNAL_ID,
        );
    });

    it('throws when only external ref exists without internal column', () => {
        assert.throws(
            () =>
                getKelviqApiCustomerId({
                    workspace_id: WORKSPACE_ID,
                    kelviq_customer_id: WORKSPACE_ID,
                    kelviq_customer_internal_id: null,
                }),
            /No Kelviq internal customer id/,
        );
    });
});

describe('getKelviqExternalCustomerId', () => {
    it('uses kelviq_customer_id when it matches workspace', () => {
        assert.equal(
            getKelviqExternalCustomerId({
                workspace_id: WORKSPACE_ID,
                kelviq_customer_id: WORKSPACE_ID,
                kelviq_customer_internal_id: INTERNAL_ID,
            }),
            WORKSPACE_ID,
        );
    });

    it('falls back to workspace_id for legacy internal-only row', () => {
        assert.equal(
            getKelviqExternalCustomerId({
                workspace_id: WORKSPACE_ID,
                kelviq_customer_id: INTERNAL_ID,
                kelviq_customer_internal_id: null,
            }),
            WORKSPACE_ID,
        );
    });
});
