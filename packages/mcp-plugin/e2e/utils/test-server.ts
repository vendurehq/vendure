import { TestServer } from '@vendure/testing';
import path from 'path';

import { initialData } from '../../../../e2e-common/e2e-initial-data';

const productsCsvPath = path.join(__dirname, '../fixtures/e2e-products.csv');

/**
 * Boots a test server with the fixture set every MCP end-to-end suite uses, so that set has one
 * definition instead of one per suite.
 */
export async function initTestServer(server: TestServer): Promise<void> {
    await server.init({ initialData, productsCsvPath, customerCount: 1 });
}
