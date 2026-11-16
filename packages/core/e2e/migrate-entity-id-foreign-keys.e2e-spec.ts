import { AutoIncrementIdStrategy } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { beforeAll } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    entityIdMigrationConfig,
    entityIdMigrationInitOptions,
    entityIdMigrationSuite,
} from './utils/entity-id-migration-suite';

const options = { entityIdStrategy: new AutoIncrementIdStrategy(), missingId: 999999 };

const env = createTestEnvironment(entityIdMigrationConfig(testConfig(), options));

beforeAll(() => env.server.init(entityIdMigrationInitOptions), TEST_SETUP_TIMEOUT_MS);

entityIdMigrationSuite(env, options);
