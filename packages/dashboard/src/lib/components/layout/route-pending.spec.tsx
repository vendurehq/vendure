import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { RoutePending } from './route-pending.js';

const routeParams = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock('@tanstack/react-router', () => ({
    useParams: () => routeParams.value,
}));

// The Trans macro compiles to the runtime Trans of @lingui/react
vi.mock('@lingui/react', () => ({
    Trans: ({ message, id }: { message?: string; id: string }) => <>{message ?? id}</>,
}));

function render(params: Record<string, string>): string {
    routeParams.value = params;
    return renderToStaticMarkup(<RoutePending />);
}

// OSS-1486 — a slow page change showed a centred spinner instead of the shape of the next page
describe('RoutePending', () => {
    it('shows the list page shape for a route without an id', () => {
        const markup = render({});

        expect(markup).toContain('aria-busy="true"');
        expect(markup).toContain('role="status"');
        expect(markup.match(/border-t/g)).toHaveLength(10);
        expect(markup).not.toContain('@3xl/layout:col-span-3');
    });

    it('shows the detail page shape for a route with an id', () => {
        const markup = render({ id: '29' });

        expect(markup).toContain('@3xl/layout:col-span-3');
        expect(markup).toContain('@3xl/layout:col-span-1');
        expect(markup).not.toContain('border-t');
    });

    it('shows the detail page shape for a new entity', () => {
        expect(render({ id: 'new' })).toContain('@3xl/layout:col-span-3');
    });
});
