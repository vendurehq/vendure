import { i18n } from '@lingui/core';
import { toast } from 'sonner';
import { uiConfig } from 'virtual:vendure-ui-config';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
    formatAgentErrorReport,
    installCopyForAgentToasts,
    recordGraphQLError,
    takeRecentAgentErrorReport,
    toAgentErrorReport,
} from './copy-for-agent.js';

const graphQLError = {
    message: 'No Product with the id "9" could be found',
    extensions: {
        code: 'ENTITY_NOT_FOUND',
        vendureCode: 'core.entity-with-id-not-found',
        requestId: 'req-1',
    },
};

const document =
    'mutation UpdateProduct($input: UpdateProductInput!) { updateProduct(input: $input) { id } }';

describe('copy for agent', () => {
    beforeAll(() => {
        i18n.loadAndActivate({ locale: 'en', messages: {} });
    });

    it('builds the report from the error extensions and the operation name', () => {
        expect(toAgentErrorReport(graphQLError, document)).toEqual({
            code: 'core.entity-with-id-not-found',
            message: 'No Product with the id "9" could be found',
            requestId: 'req-1',
            operation: 'UpdateProduct',
            versions: { dashboard: uiConfig.version },
        });
    });

    it('offers nothing for an error without a code and a request ID, such as a network error', () => {
        expect(toAgentErrorReport(new TypeError('Failed to fetch'), document)).toBeUndefined();
        expect(
            toAgentErrorReport({ message: 'x', extensions: { vendureCode: 'core.x' } }, document),
        ).toBeUndefined();
    });

    it('ends the clipboard text with the vendure explain command', () => {
        const report = toAgentErrorReport(graphQLError, document)!;
        const text = formatAgentErrorReport(report);
        expect(JSON.parse(text.split('\n\n')[0])).toEqual(report);
        expect(text.endsWith('\n\nvendure explain req-1')).toBe(true);
    });

    it('offers a recorded error to one toast only, and only while it is recent', () => {
        recordGraphQLError(graphQLError, document, 1_000);
        expect(takeRecentAgentErrorReport(2_000)?.requestId).toBe('req-1');
        expect(takeRecentAgentErrorReport(2_000)).toBeUndefined();

        recordGraphQLError(graphQLError, document, 1_000);
        expect(takeRecentAgentErrorReport(60_000)).toBeUndefined();
    });

    it('adds the action to an error toast that follows a failed request', () => {
        const showError = vi.fn();
        toast.error = showError as unknown as typeof toast.error;
        installCopyForAgentToasts();

        recordGraphQLError(graphQLError, document);
        toast.error('Failed to update product', { description: 'details' });
        expect(showError).toHaveBeenLastCalledWith('Failed to update product', {
            description: 'details',
            action: expect.objectContaining({ label: 'Copy for agent' }),
        });

        // No failed request since, so the next error toast is left as it is.
        toast.error('Something else went wrong');
        expect(showError).toHaveBeenLastCalledWith('Something else went wrong', undefined);
    });
});
