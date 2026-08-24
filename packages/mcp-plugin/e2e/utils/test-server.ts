import { TestServerOptions } from '@vendure/testing';
import path from 'path';

import { initialData } from '../../../../e2e-common/e2e-initial-data';

const productsCsvPath = path.join(__dirname, '../fixtures/e2e-products.csv');

/**
 * The fixture set every MCP end-to-end suite boots with, so that set has one definition instead of
 * one per suite. Each suite passes this to `server.init()` itself rather than through a wrapper
 * function: the test framework names each suite's database after the file that calls `init()`, so
 * a shared wrapper here would point every suite at one database and break Postgres runs.
 */
export const testServerInit: TestServerOptions = { initialData, productsCsvPath, customerCount: 1 };
