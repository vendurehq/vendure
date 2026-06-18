import { ArgumentsHost, OnApplicationBootstrap } from '@nestjs/common';
import { Mutation, Resolver } from '@nestjs/graphql';
import {
    mergeConfig,
    Job,
    ErrorHandlerStrategy,
    VendurePlugin,
    PluginCommonModule,
    JobQueueService,
    JobQueue,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { awaitRunningJobs } from './utils/await-running-jobs';

class TestErrorHandlerStrategy implements ErrorHandlerStrategy {
    static serverErrorSpy = vi.fn();
    static workerErrorSpy = vi.fn();

    handleServerError(exception: Error, context: { host: ArgumentsHost }) {
        TestErrorHandlerStrategy.serverErrorSpy(exception, context);
    }

    handleWorkerError(exception: Error, context: { job: Job }) {
        TestErrorHandlerStrategy.workerErrorSpy(exception, context);
    }
}

@Resolver()
class TestResolver implements OnApplicationBootstrap {
    private queue: JobQueue<any>;
    constructor(private jobQueueService: JobQueueService) {}

    async onApplicationBootstrap() {
        this.queue = await this.jobQueueService.createQueue({
            name: 'test-queue',
            process: async () => {
                throw new Error('worker error');
            },
        });
    }

    @Mutation()
    createServerError() {
        throw new Error('server error');
    }

    @Mutation()
    createWorkerError() {
        return this.queue.add({});
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend type Mutation {
                createServerError: Boolean!
                createWorkerError: Job!
            }
        `,
        resolvers: [TestResolver],
    },
})
class TestErrorMakingPlugin {}

describe('ErrorHandlerStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            systemOptions: {
                errorHandlers: [new TestErrorHandlerStrategy()],
            },
            plugins: [TestErrorMakingPlugin],
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

    beforeEach(() => {
        TestErrorHandlerStrategy.serverErrorSpy.mockClear();
        TestErrorHandlerStrategy.workerErrorSpy.mockClear();
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('no error handler have initially been called', async () => {
        expect(TestErrorHandlerStrategy.serverErrorSpy).toHaveBeenCalledTimes(0);
        expect(TestErrorHandlerStrategy.workerErrorSpy).toHaveBeenCalledTimes(0);
    });

    it('invokes the server handler', async () => {
        try {
            await adminClient.query(gql`
                mutation {
                    createServerError
                }
            `);
        } catch (e: any) {
            expect(e.message).toBe('server error');
        }
        expect(TestErrorHandlerStrategy.serverErrorSpy).toHaveBeenCalledTimes(1);
        expect(TestErrorHandlerStrategy.workerErrorSpy).toHaveBeenCalledTimes(0);

        expect(TestErrorHandlerStrategy.serverErrorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(TestErrorHandlerStrategy.serverErrorSpy.mock.calls[0][0].message).toBe('server error');
        expect(TestErrorHandlerStrategy.serverErrorSpy.mock.calls[0][1].host).toBeDefined();
    });

    it('invokes the worker handler', async () => {
        await adminClient.query(gql`
            mutation {
                createWorkerError {
                    id
                }
            }
        `);
        await awaitRunningJobs(adminClient);
        expect(TestErrorHandlerStrategy.serverErrorSpy).toHaveBeenCalledTimes(0);
        expect(TestErrorHandlerStrategy.workerErrorSpy).toHaveBeenCalledTimes(1);

        expect(TestErrorHandlerStrategy.workerErrorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(TestErrorHandlerStrategy.workerErrorSpy.mock.calls[0][0].message).toBe('worker error');
        expect(TestErrorHandlerStrategy.workerErrorSpy.mock.calls[0][1].job).toHaveProperty(
            'queueName',
            'test-queue',
        );
    });
});
