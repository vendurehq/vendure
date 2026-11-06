import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChannelColorSwatch, ChannelIdentity } from './channel-identity.js';

describe('ChannelIdentity', () => {
    it('uses a prominent channel color marker', () => {
        const markup = renderToStaticMarkup(<ChannelIdentity color="viz-1" />);

        expect(markup).toContain('size-3.5');
    });
});

describe('ChannelColorSwatch', () => {
    it.each([
        ['viz-1', 'bg-chart-1'],
        ['viz-2', 'bg-chart-2'],
        ['viz-3', 'bg-chart-3'],
        ['viz-4', 'bg-chart-4'],
        ['viz-5', 'bg-chart-5'],
    ] as const)('maps %s to the corresponding dashboard theme color', (color, expectedClass) => {
        const markup = renderToStaticMarkup(<ChannelColorSwatch color={color} />);

        expect(markup).toContain(expectedClass);
        expect(markup).toContain('inline-flex');
    });
});
