import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { useForm } from 'react-hook-form';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FormErrorSummary } from './form-error-summary.js';

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

function Summary() {
    const form = useForm({
        errors: { sku: { type: 'required', message: 'SKU is required' } },
    });
    return <FormErrorSummary form={form} />;
}

describe('FormErrorSummary', () => {
    it('lists each field as an in-page link, not a hand-styled button', () => {
        const markup = renderToStaticMarkup(
            <I18nProvider i18n={i18n}>
                <Summary />
            </I18nProvider>,
        );

        expect(markup).toContain('<a href="#sku">Sku</a>');
        expect(markup).toContain('SKU is required');
        expect(markup).not.toContain('<button');
    });
});
