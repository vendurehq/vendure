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
    it('renders a success badge for a true value that shows only on row hover or focus', () => {
        const markup = render(<BooleanDisplayBadge value={true} />);

        expect(markup).toContain('Enabled');
        expect(markup).toContain('data-tone="success"');
        expect(markup).toContain('opacity-0');
        expect(markup).toContain('group-hover/row:opacity-100');
        expect(markup).toContain('group-focus-within/row:opacity-100');
    });

    it('renders an always-visible Disabled badge with the state dictionary tone for a false value', () => {
        const markup = render(<BooleanDisplayBadge value={false} />);

        expect(markup).toContain('Disabled');
        expect(markup).toContain('data-tone="neutral"');
        expect(markup).not.toContain('opacity-0');
    });

    it('uses the custom labels', () => {
        expect(render(<BooleanDisplayBadge value={true} labelTrue="Active" />)).toContain('Active');
        expect(render(<BooleanDisplayBadge value={false} labelFalse="Inactive" />)).toContain('Inactive');
    });
});
