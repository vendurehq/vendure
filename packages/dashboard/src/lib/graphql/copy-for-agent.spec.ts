import { i18n } from '@lingui/core';
import { GraphQLRequestError } from 'awesome-graphql-client';
import { toast } from 'sonner';
import { uiConfig } from 'virtual:vendure-ui-config';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    formatAgentErrorReport,
    installCopyForAgentToasts,
    recordGraphQLError,
    takeMatchingAgentErrorReport,
    toAgentErrorReport,
} from './copy-for-agent.js';

const MESSAGE = 'No Product with the id "9" could be found';

/** The error the GraphQL client throws, which prefixes the server's message with its own text. */
function requestError(extensions: Record<string, unknown>) {
    return new GraphQLRequestError({
        query: UPDATE_PRODUCT_DOCUMENT,
        response: new Response(),
        message: MESSAGE,
        extensions,
        fieldErrors: [{ message: MESSAGE, extensions } as any],
    });
}

const extensions = {
    code: 'ENTITY_NOT_FOUND',
    vendureCode: 'core.entity-with-id-not-found',
    requestId: 'req-1',
};
const UPDATE_PRODUCT_DOCUMENT =
    'mutation UpdateProduct($input: UpdateProductInput!) { updateProduct(input: $input) { id } }';

describe('copy for agent', () => {
    const showError = toast.error;

    beforeAll(() => {
        i18n.loadAndActivate({ locale: 'en', messages: {} });
    });

    afterEach(() => {
        toast.error = showError;
        vi.restoreAllMocks();
    });

    it("builds the report from the error extensions, the server's message and the operation name", () => {
        const error = requestError(extensions);
        expect(error.message).not.toBe(MESSAGE);
        expect(toAgentErrorReport(error, UPDATE_PRODUCT_DOCUMENT)).toEqual({
            code: 'core.entity-with-id-not-found',
            message: MESSAGE,
            requestId: 'req-1',
            operation: 'UpdateProduct',
            versions: { dashboard: uiConfig.version },
        });
    });

    it('offers nothing for an error without a code and a request ID, such as a network error', () => {
        expect(toAgentErrorReport(new TypeError('Failed to fetch'), UPDATE_PRODUCT_DOCUMENT)).toBeUndefined();
        expect(
            toAgentErrorReport(requestError({ vendureCode: 'core.x' }), UPDATE_PRODUCT_DOCUMENT),
        ).toBeUndefined();
    });

    it('copies the report as JSON, followed by the vendure explain command', () => {
        const report = toAgentErrorReport(requestError(extensions), UPDATE_PRODUCT_DOCUMENT)!;
        const parts = formatAgentErrorReport(report).split('\n\n');

        expect(parts).toHaveLength(2);
        expect(JSON.parse(parts[0])).toEqual(report);
        expect(parts[1]).toBe('npx vendure explain --json req-1\n');
    });

    it('ends the options before a request ID that starts with a dash', () => {
        const report = toAgentErrorReport(requestError(extensions), UPDATE_PRODUCT_DOCUMENT)!;

        expect(formatAgentErrorReport({ ...report, requestId: '-x' }).split('\n\n')[1]).toBe(
            'npx vendure explain --json -- -x\n',
        );
    });

    it('offers a recorded error only to a toast that shows its message, once, while it is recent', () => {
        recordGraphQLError(requestError(extensions), UPDATE_PRODUCT_DOCUMENT, 1_000);
        expect(takeMatchingAgentErrorReport(['Failed to update product'], 2_000)).toBeUndefined();
        expect(takeMatchingAgentErrorReport(['Failed', `Error: ${MESSAGE}`], 2_000)?.requestId).toBe('req-1');
        expect(takeMatchingAgentErrorReport([MESSAGE], 2_000)).toBeUndefined();

        recordGraphQLError(requestError(extensions), UPDATE_PRODUCT_DOCUMENT, 1_000);
        expect(takeMatchingAgentErrorReport([MESSAGE], 60_000)).toBeUndefined();
    });

    it('adds the action to the error toast about a failed request, and to no other', async () => {
        // installCopyForAgentToasts() wraps whatever toast.error is when it is first called.
        const stub = vi.fn();
        toast.error = stub as unknown as typeof toast.error;
        installCopyForAgentToasts();

        recordGraphQLError(requestError(extensions), UPDATE_PRODUCT_DOCUMENT);
        toast.error('Something unrelated went wrong');
        expect(stub).toHaveBeenLastCalledWith('Something unrelated went wrong', undefined);

        const error = requestError(extensions);
        toast.error('Failed to update product', { description: error.message });
        expect(stub).toHaveBeenLastCalledWith('Failed to update product', {
            description: error.message,
            action: expect.objectContaining({ label: 'Copy for agent' }),
        });

        // Clicking it copies the report, and says so.
        const action = stub.mock.lastCall?.[1].action as { onClick: () => void };
        const report = toAgentErrorReport(error, UPDATE_PRODUCT_DOCUMENT)!;
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const success = vi.spyOn(toast, 'success');
        action.onClick();
        await vi.waitFor(() => expect(success).toHaveBeenCalled());
        expect(writeText).toHaveBeenCalledWith(formatAgentErrorReport(report));

        // When the clipboard refuses, the report goes to the console instead.
        writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
        const info = vi.spyOn(toast, 'info');
        const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        action.onClick();
        await vi.waitFor(() => expect(info).toHaveBeenCalled());
        expect(log).toHaveBeenCalledWith(formatAgentErrorReport(report));
    });
});
