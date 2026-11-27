import { STORE_READINESS_FIX_TOOLS } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { metadataFor } from '../spec-helpers';

import { adminToolProviders } from './index';

/**
 * Core names the MCP admin tools that store readiness fixes call, because the report is built in
 * core. This spec fails when one of those tools is renamed or removed here.
 */
describe('store readiness fix tools', () => {
    const adminToolNames = adminToolProviders.map(provider => metadataFor(provider).name);

    it.each([...STORE_READINESS_FIX_TOOLS])('%s is a registered admin tool', name => {
        expect(adminToolNames).toContain(name);
    });
});
