import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MoneyInput } from './money-input.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The precision the reporter had configured. Every hook which needs it reads it from the
// server config, so mocking that one seam covers both the display and the minor-unit
// conversion.
const MONEY_STRATEGY_PRECISION = 3;

vi.mock('@/vdb/hooks/use-server-config.js', () => ({
    useServerConfig: () => ({ moneyStrategyPrecision: MONEY_STRATEGY_PRECISION }),
}));

vi.mock('@/vdb/hooks/use-channel.js', () => ({
    useChannel: () => ({ activeChannel: { defaultCurrencyCode: 'USD' } }),
}));

vi.mock('@/vdb/hooks/use-display-locale.js', () => ({
    useDisplayLocale: () => ({ bcp47Tag: 'en-US', isRTL: false }),
}));

const containers: HTMLElement[] = [];

async function renderMoneyInput(value: number) {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(createElement(MoneyInput, { value, onChange } as any));
    });
    const input = container.querySelector('input') as HTMLInputElement;
    return {
        input,
        onChange,
        // jsdom fires focusin/focusout alongside focus/blur, which is what React 19 listens
        // for at the root container.
        focus: () => act(async () => input.focus()),
        blur: () => act(async () => input.blur()),
        press: (key: string) =>
            act(async () => {
                input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            }),
        unmount: () => act(() => root.unmount()),
    };
}

afterEach(() => {
    for (const container of containers.splice(0)) {
        container.remove();
    }
});

// #5447 — MoneyInput hardcoded 2 decimals and a 0.01 step, so at moneyStrategyPrecision 3
// a stored 275 displayed as 0.28 and a focus/blur with no typing wrote 280 back.
describe('MoneyInput at moneyStrategyPrecision 3', () => {
    it('displays 275 minor units as 0.275', async () => {
        const { input, unmount } = await renderMoneyInput(275);
        expect(input.value).toBe('0.275');
        unmount();
    });

    it('leaves the value unchanged when the field is focused and blurred without typing', async () => {
        const { input, onChange, focus, blur, unmount } = await renderMoneyInput(275);
        await focus();
        await blur();
        for (const call of onChange.mock.calls) {
            expect(call[0]).toBe(275);
        }
        expect(input.value).toBe('0.275');
        unmount();
    });

    it('steps by the smallest unit of the precision on ArrowUp', async () => {
        const { input, onChange, focus, press, unmount } = await renderMoneyInput(275);
        await focus();
        await press('ArrowUp');
        expect(onChange).toHaveBeenLastCalledWith(276);
        expect(input.value).toBe('0.276');
        unmount();
    });
});
