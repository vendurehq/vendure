import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdentifierDisplay } from './identifier.js';

describe('IdentifierDisplay', () => {
    it('renders the full value in a copy chip', () => {
        const markup = renderToStaticMarkup(<IdentifierDisplay value="laptop-screen-size" />);

        expect(markup).toContain('data-slot="id-chip"');
        expect(markup).toContain('>laptop-screen-size</span>');
        expect(markup).toContain('data-slot="copy-button"');
    });

    it('hides the chip chrome until the row is hovered or focused', () => {
        const markup = renderToStaticMarkup(<IdentifierDisplay value="laptop" />);

        expect(markup).toContain('bg-transparent');
        expect(markup).toContain('group-hover/row:bg-muted');
        expect(markup).toContain('group-focus-within/row:bg-muted');
        expect(markup).toContain('[&amp;_[data-slot=copy-button]]:opacity-0');
    });

    it('renders nothing for an empty value', () => {
        expect(renderToStaticMarkup(<IdentifierDisplay value="" />)).toBe('');
        expect(renderToStaticMarkup(<IdentifierDisplay value={null} />)).toBe('');
    });
});
