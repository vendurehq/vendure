/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    CachedSession,
    Ctx,
    mergeConfig,
    PluginCommonModule,
    RequestContext,
    Session,
    SessionCacheStrategy,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomSessionFields {
        testField?: string;
        testDate?: Date;
    }
}

const setSpy = vi.fn();

class TestingSessionCacheStrategy implements SessionCacheStrategy {
    private cache = new Map<string, CachedSession>();

    get(sessionToken: string) {
        return this.cache.get(sessionToken);
    }

    set(session: CachedSession) {
        setSpy(session);
        this.cache.set(session.token, session);
    }

    delete(sessionToken: string) {
        this.cache.delete(sessionToken);
    }

    clear() {
        this.cache.clear();
    }
}

@Resolver()
class SessionCustomFieldsTestResolver {
    constructor(private connection: TransactionalConnection) {}

    @Query()
    sessionCustomFields(@Ctx() ctx: RequestContext) {
        return ctx.session?.customFields;
    }

    @Mutation()
    async setSessionCustomFields(@Ctx() ctx: RequestContext, @Args() args: { value: string; date: Date }) {
        const sessionRepository = this.connection.rawConnection.getRepository(Session);
        const session = await sessionRepository.findOneOrFail({ where: { id: ctx.session!.id } });
        session.customFields = { ...session.customFields, testField: args.value, testDate: args.date };
        await sessionRepository.save(session);
        return true;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend type Query {
                sessionCustomFields: JSON
            }
            extend type Mutation {
                setSessionCustomFields(value: String!, date: DateTime!): Boolean!
            }
        `,
        resolvers: [SessionCustomFieldsTestResolver],
    },
})
class SessionCustomFieldsTestPlugin {}

describe('Session custom fields', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                sessionCacheStrategy: new TestingSessionCacheStrategy(),
                sessionCacheTTL: 2,
            },
            customFields: {
                Session: [
                    { name: 'testField', type: 'string', nullable: true },
                    { name: 'testDate', type: 'datetime', nullable: true },
                ],
            },
            plugins: [SessionCustomFieldsTestPlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('includes custom fields in the cached session', async () => {
        await adminClient.query(gql`
            mutation {
                setSessionCustomFields(value: "hello", date: "2025-01-01T12:00:00.000Z")
            }
        `);

        // Wait for the cache TTL to expire, so that the session gets
        // reloaded from the database and cached again.
        await pause(2100);
        setSpy.mockClear();

        const { sessionCustomFields } = await adminClient.query(gql`
            query {
                sessionCustomFields
            }
        `);

        const expected = { testField: 'hello', testDate: '2025-01-01T12:00:00.000Z' };
        expect(setSpy.mock.lastCall?.[0].customFields).toEqual(expected);
        expect(sessionCustomFields).toEqual(expected);
    });
});

function pause(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
