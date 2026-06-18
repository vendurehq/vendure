import { VendureConfig } from '@vendure/core';

import { SimpleGraphQLClient } from './simple-graphql-client';
import { TestServer } from './test-server';

/**
 * @description
 * The return value of {@link createTestEnvironment}, containing the test server
 * and clients for the Shop API and Admin API.
 *
 * @docsCategory testing
 */
export interface TestEnvironment {
    /**
     * @description
     * A Vendure server instance against which GraphQL requests can be made.
     */
    server: TestServer;
    /**
     * @description
     * A GraphQL client configured for the Admin API.
     */
    adminClient: SimpleGraphQLClient;
    /**
     * @description
     * A GraphQL client configured for the Shop API.
     */
    shopClient: SimpleGraphQLClient;
}

/**
 * @description
 * Configures a {@link TestServer} and a {@link SimpleGraphQLClient} for each of the GraphQL APIs
 * for use in end-to-end tests. Returns a {@link TestEnvironment} object.
 *
 * @example
 * ```ts
 * import { createTestEnvironment, testConfig } from '\@vendure/testing';
 *
 * describe('some feature to test', () => {
 *
 *   const { server, adminClient, shopClient } = createTestEnvironment(testConfig);
 *
 *   beforeAll(async () => {
 *     await server.init({
 *         // ... server options
 *     });
 *     await adminClient.asSuperAdmin();
 *   });
 *
 *   afterAll(async () => {
 *       await server.destroy();
 *   });
 *
 *   // ... end-to-end tests here
 * });
 * ```
 * @docsCategory testing
 */
export function createTestEnvironment(config: Required<VendureConfig>): TestEnvironment {
    const server = new TestServer(config);
    const { port, adminApiPath, shopApiPath } = config.apiOptions;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const adminClient = new SimpleGraphQLClient(config, `http://localhost:${port}/${adminApiPath!}`);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const shopClient = new SimpleGraphQLClient(config, `http://localhost:${port}/${shopApiPath!}`);
    return {
        server,
        adminClient,
        shopClient,
    };
}
