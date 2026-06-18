import { ApolloServerPlugin, GraphQLRequestListener, GraphQLServerContext } from '@apollo/server';
import { mergeConfig } from '@vendure/core';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { createTestEnvironment } from '../../testing/lib/create-test-environment';

import { getProductIdNameDocument } from './graphql/shared-definitions';

class MyApolloServerPlugin implements ApolloServerPlugin {
    static serverWillStartFn = vi.fn();
    static requestDidStartFn = vi.fn();
    static willSendResponseFn = vi.fn();

    static reset() {
        this.serverWillStartFn = vi.fn();
        this.requestDidStartFn = vi.fn();
        this.willSendResponseFn = vi.fn();
    }

    async serverWillStart(service: GraphQLServerContext): Promise<void> {
        MyApolloServerPlugin.serverWillStartFn(service);
    }

    async requestDidStart(): Promise<GraphQLRequestListener<any>> {
        MyApolloServerPlugin.requestDidStartFn();
        return {
            async willSendResponse(requestContext): Promise<void> {
                const { body } = requestContext.response;
                if (body.kind === 'single') {
                    MyApolloServerPlugin.willSendResponseFn(body.singleResult.data);
                }
            },
        };
    }
}

describe('custom apolloServerPlugins', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            apiOptions: {
                apolloServerPlugins: [new MyApolloServerPlugin()],
            },
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

    it('calls serverWillStart()', () => {
        expect(MyApolloServerPlugin.serverWillStartFn).toHaveBeenCalled();
    });

    it('runs plugin on shop api query', async () => {
        MyApolloServerPlugin.reset();
        await shopClient.query(getProductIdNameDocument, { id: 'T_1' });

        expect(MyApolloServerPlugin.requestDidStartFn).toHaveBeenCalledTimes(1);
        expect(MyApolloServerPlugin.willSendResponseFn).toHaveBeenCalledTimes(1);
        expect(MyApolloServerPlugin.willSendResponseFn.mock.calls[0][0]).toEqual({
            product: {
                id: 'T_1',
                name: 'Laptop',
            },
        });
    });

    it('runs plugin on admin api query', async () => {
        MyApolloServerPlugin.reset();
        await adminClient.query(getProductIdNameDocument, { id: 'T_1' });

        expect(MyApolloServerPlugin.requestDidStartFn).toHaveBeenCalledTimes(1);
        expect(MyApolloServerPlugin.willSendResponseFn).toHaveBeenCalledTimes(1);
        expect(MyApolloServerPlugin.willSendResponseFn.mock.calls[0][0]).toEqual({
            product: {
                id: 'T_1',
                name: 'Laptop',
            },
        });
    });
});
