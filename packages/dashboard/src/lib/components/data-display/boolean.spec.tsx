import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BooleanDisplayBadge, BooleanDisplayYesNoBadge } from './boolean.js';

const i18n = setupI18n({
    locale: 'en',
    messages: {
        en: {
            Yes: 'Yes',
            No: 'No',
            Enabled: 'Enabled',
            Disabled: 'Disabled',
        },
    },
});

function render(element: ReactElement) {
    return renderToStaticMarkup(<I18nProvider i18n={i18n}>{element}</I18nProvider>);
}

function renderBadge(value: boolean) {
    return render(<BooleanDisplayYesNoBadge value={value} />);
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

describe('BooleanDisplayBadge', () => {
    it('renders only a screen-reader label for a true value', () => {
        const markup = render(<BooleanDisplayBadge value={true} />);

        expect(markup).toBe('<span class="sr-only">Enabled</span>');
    });

    it('renders a Disabled badge with the neutral tone for a false value', () => {
        const markup = render(<BooleanDisplayBadge value={false} />);

        expect(markup).toContain('Disabled');
        expect(markup).toContain('data-tone="neutral"');
        expect(markup).not.toContain('sr-only');
    });

    it('uses the custom labels', () => {
        expect(render(<BooleanDisplayBadge value={true} labelTrue="Active" />)).toBe(
            '<span class="sr-only">Active</span>',
        );
        expect(render(<BooleanDisplayBadge value={false} labelFalse="Inactive" />)).toContain('Inactive');
    });
});
