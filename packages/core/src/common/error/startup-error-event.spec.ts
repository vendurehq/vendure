import { describe, expect, it } from 'vitest';

import { ForbiddenError } from './errors';
import { toStartupErrorEvent } from './startup-error-event';
import { VendureStartupError } from './vendure-startup-error';

describe('toStartupErrorEvent()', () => {
    it('carries the code and fixes of a VendureStartupError', () => {
        const error = new VendureStartupError({
            code: 'core.config.invalid-custom-fields',
            message: 'CustomFields config error',
            fix: [{ description: 'Correct the custom field' }],
        });

        expect(toStartupErrorEvent(error)).toEqual({
            vendure: 'event',
            event: 'startup-error',
            code: 'core.config.invalid-custom-fields',
            message: 'CustomFields config error',
            fix: [{ description: 'Correct the custom field' }],
        });
    });

    it('uses the vendureCode of an I18nError', () => {
        expect(toStartupErrorEvent(new ForbiddenError())).toMatchObject({ code: 'core.forbidden', fix: [] });
    });

    it('gives any other error the unexpected code', () => {
        expect(toStartupErrorEvent(new Error('boom'))).toMatchObject({
            code: 'core.unexpected',
            message: 'boom',
            fix: [],
        });
        expect(toStartupErrorEvent('boom')).toMatchObject({ code: 'core.unexpected', message: 'boom' });
    });

    it('serializes to one line', () => {
        const error = new VendureStartupError({ code: 'core.config.x', message: 'line one\nline two' });
        expect(JSON.stringify(toStartupErrorEvent(error))).not.toContain('\n');
    });
});
