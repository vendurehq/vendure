import { i18n } from '@lingui/core';
import { GraphQLRequestError } from 'awesome-graphql-client';
import { toast } from 'sonner';
import { uiConfig } from 'virtual:vendure-ui-config';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
        query: document,
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
const document =
    'mutation UpdateProduct($input: UpdateProductInput!) { updateProduct(input: $input) { id } }';

describe('copy for agent', () => {
    beforeAll(() => {
        i18n.loadAndActivate({ locale: 'en', messages: {} });
    });

    it("builds the report from the error extensions, the server's message and the operation name", () => {
        const error = requestError(extensions);
        expect(error.message).not.toBe(MESSAGE);
        expect(toAgentErrorReport(error, document)).toEqual({
            code: 'core.entity-with-id-not-found',
            message: MESSAGE,
            requestId: 'req-1',
            operation: 'UpdateProduct',
            versions: { dashboard: uiConfig.version },
        });
    });

    it('offers nothing for an error without a code and a request ID, such as a network error', () => {
        expect(toAgentErrorReport(new TypeError('Failed to fetch'), document)).toBeUndefined();
        expect(toAgentErrorReport(requestError({ vendureCode: 'core.x' }), document)).toBeUndefined();
    });

    it('copies the report as JSON', () => {
        const report = toAgentErrorReport(requestError(extensions), document)!;
        expect(JSON.parse(formatAgentErrorReport(report))).toEqual(report);
    });

    it('offers a recorded error only to a toast that shows its message, once, while it is recent', () => {
        recordGraphQLError(requestError(extensions), document, 1_000);
        expect(takeMatchingAgentErrorReport(['Failed to update product'], 2_000)).toBeUndefined();
        expect(takeMatchingAgentErrorReport(['Failed', `Error: ${MESSAGE}`], 2_000)?.requestId).toBe('req-1');
        expect(takeMatchingAgentErrorReport([MESSAGE], 2_000)).toBeUndefined();

        recordGraphQLError(requestError(extensions), document, 1_000);
        expect(takeMatchingAgentErrorReport([MESSAGE], 60_000)).toBeUndefined();
    });

    it('adds the action to the error toast about a failed request, and to no other', () => {
        const showError = vi.fn();
        toast.error = showError as unknown as typeof toast.error;
        installCopyForAgentToasts();

        recordGraphQLError(requestError(extensions), document);
        toast.error('Something unrelated went wrong');
        expect(showError).toHaveBeenLastCalledWith('Something unrelated went wrong', undefined);

        const error = requestError(extensions);
        toast.error('Failed to update product', { description: error.message });
        expect(showError).toHaveBeenLastCalledWith('Failed to update product', {
            description: error.message,
            action: expect.objectContaining({ label: 'Copy for agent' }),
        });
    });
});
