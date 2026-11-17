import { UuidIdStrategy } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { beforeAll } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    entityIdMigrationConfig,
    entityIdMigrationInitOptions,
    entityIdMigrationSuite,
} from './utils/entity-id-migration-suite';

// Runs with a table prefix, so the helper must honour `entityPrefix`.
const options = {
    entityIdStrategy: new UuidIdStrategy(),
    missingId: '00000000-0000-4000-8000-000000000000',
    entityPrefix: 'vdr_',
};

const env = createTestEnvironment(entityIdMigrationConfig(testConfig(), options));

beforeAll(() => env.server.init(entityIdMigrationInitOptions), TEST_SETUP_TIMEOUT_MS);

entityIdMigrationSuite(env, options);
