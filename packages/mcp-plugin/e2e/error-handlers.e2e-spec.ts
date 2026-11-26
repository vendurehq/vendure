import { ArgumentsHost } from '@nestjs/common';
import { ErrorHandlerStrategy, Job, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';

import { McpTestToolsPlugin } from './fixtures/mcp-test-tools';
import { callTool, postMcp } from './utils/mcp-http-client';
import { testServerInit } from './utils/test-server';

class RecordingErrorHandlerStrategy implements ErrorHandlerStrategy {
    static serverErrorSpy = vi.fn();

    handleServerError(exception: Error, context: { host: ArgumentsHost }) {
        RecordingErrorHandlerStrategy.serverErrorSpy(exception, context);
    }

    handleWorkerError(_exception: Error, _context: { job: Job }) {
        // Not used: an MCP tool call never runs on the worker.
    }
}

describe('MCP tool errors and systemOptions.errorHandlers', () => {
    const config = mergeConfig(testConfig(), {
        systemOptions: { errorHandlers: [new RecordingErrorHandlerStrategy()] },
        plugins: [McpTestToolsPlugin, McpPlugin.init({})],
    });
    const { server } = createTestEnvironment(config);
    const baseUrl = `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        await server.init(testServerInit);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    beforeEach(() => {
        RecordingErrorHandlerStrategy.serverErrorSpy.mockClear();
    });

    it('passes the error of a failing tool to the error handlers and still returns the generic message', async () => {
        const response = await postMcp(baseUrl, 'shop', callTool('shop_boom', {}, 1));
        expect(response.body.result.isError).toBe(true);
        expect(response.body.result.content[0].text).toMatch(/failed unexpectedly/);
        expect(RecordingErrorHandlerStrategy.serverErrorSpy).toHaveBeenCalledTimes(1);
        const [exception] = RecordingErrorHandlerStrategy.serverErrorSpy.mock.calls[0];
        expect(exception).toBeInstanceOf(Error);
        expect(exception.message).toBe('boom');
    });

    it('does not call the error handlers for an error meant for the caller', async () => {
        const response = await postMcp(baseUrl, 'shop', callTool('shop_bad_input', {}, 2));
        expect(response.body.result.isError).toBe(true);
        expect(response.body.result.content[0].text).toMatch(/bad-input-from-caller/);
        expect(RecordingErrorHandlerStrategy.serverErrorSpy).not.toHaveBeenCalled();
    });

    it('does not call the error handlers for a tool that succeeds', async () => {
        const response = await postMcp(baseUrl, 'shop', callTool('shop_ping', { text: 'hello' }, 3));
        expect(response.body.result.isError).toBeUndefined();
        expect(RecordingErrorHandlerStrategy.serverErrorSpy).not.toHaveBeenCalled();
    });
});
