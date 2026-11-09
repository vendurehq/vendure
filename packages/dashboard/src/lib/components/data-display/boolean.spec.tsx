import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BooleanDisplayYesNoBadge } from './boolean.js';

const i18n = setupI18n({
    locale: 'en',
    messages: {
        en: {
            Yes: 'Yes',
            No: 'No',
        },
    },
});

function renderBadge(value: boolean) {
    return renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
            <BooleanDisplayYesNoBadge value={value} />
        </I18nProvider>,
    );
}

describe('BooleanDisplayYesNoBadge', () => {
    it('renders Yes with the success tone for a true value', () => {
        const markup = renderBadge(true);

        expect(markup).toContain('Yes');
        expect(markup).toContain('data-tone="success"');
    });

    it('renders No with the neutral tone for a false value', () => {
        const markup = renderBadge(false);

        expect(markup).toContain('No');
        expect(markup).toContain('data-tone="neutral"');
    });
});
