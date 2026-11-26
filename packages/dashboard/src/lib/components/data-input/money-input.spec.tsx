import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MoneyInput } from './money-input.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The precision the #5447 reporter had configured. Every hook which needs it reads it from the
// server config, so mocking that one seam covers both the display and the minor-unit
// conversion.
const serverConfig = vi.hoisted(() => ({ moneyStrategyPrecision: 3 }));

vi.mock('@/vdb/hooks/use-server-config.js', () => ({
    useServerConfig: () => serverConfig,
}));

vi.mock('@/vdb/hooks/use-channel.js', () => ({
    useChannel: () => ({ activeChannel: { defaultCurrencyCode: 'USD' } }),
}));

const displayLocale = vi.hoisted(() => ({ bcp47Tag: 'en-US' }));

vi.mock('@/vdb/hooks/use-display-locale.js', () => ({
    useDisplayLocale: () => ({ bcp47Tag: displayLocale.bcp47Tag, isRTL: false }),
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
        // Types `text` one character at a time, as a user would, so that every intermediate
        // value goes through the change handler.
        type: async (text: string) => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            for (const char of text) {
                await act(async () => {
                    setValue.call(input, input.value + char);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
            }
        },
        clear: () =>
            act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }),
        press: (key: string) =>
            act(async () => {
                input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            }),
        unmount: () => act(() => root.unmount()),
    };
}

afterEach(() => {
    displayLocale.bcp47Tag = 'en-US';
    serverConfig.moneyStrategyPrecision = 3;
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

// #5969 — MoneyInput only accepted digits and a dot, so in a comma-decimal locale the comma
// of "1,50" was dropped and the price was saved as 150.00.
describe('MoneyInput in a comma decimal locale', () => {
    beforeEach(() => {
        displayLocale.bcp47Tag = 'de-DE';
        serverConfig.moneyStrategyPrecision = 2;
    });

    it('reads a typed comma as the decimal separator', async () => {
        const { input, onChange, focus, clear, type, blur, unmount } = await renderMoneyInput(0);
        await focus();
        await clear();
        await type('1,50');
        expect(input.value).toBe('1,50');
        expect(onChange).toHaveBeenLastCalledWith(150);
        await blur();
        expect(onChange).toHaveBeenLastCalledWith(150);
        expect(input.value).toBe('1,50');
        unmount();
    });

    it('still accepts a dot as the decimal separator', async () => {
        const { onChange, focus, clear, type, blur, unmount } = await renderMoneyInput(0);
        await focus();
        await clear();
        await type('2.25');
        await blur();
        expect(onChange).toHaveBeenLastCalledWith(225);
        unmount();
    });

    it('displays the stored value with the locale decimal separator', async () => {
        const { input, unmount } = await renderMoneyInput(1299);
        expect(input.value).toBe('12,99');
        unmount();
    });

    it('steps from a comma value on ArrowUp', async () => {
        const { input, onChange, focus, press, unmount } = await renderMoneyInput(150);
        await focus();
        await press('ArrowUp');
        expect(onChange).toHaveBeenLastCalledWith(151);
        expect(input.value).toBe('1,51');
        unmount();
    });

    it('rejects a second decimal separator', async () => {
        const { input, onChange, focus, clear, type, unmount } = await renderMoneyInput(0);
        await focus();
        await clear();
        await type('1,5,0');
        expect(input.value).toBe('1,50');
        expect(onChange).toHaveBeenLastCalledWith(150);
        unmount();
    });
});

describe('MoneyInput in a dot decimal locale', () => {
    beforeEach(() => {
        serverConfig.moneyStrategyPrecision = 2;
    });

    // In en-US the comma is the thousands separator, so it must not be read as a decimal
    it('does not read a comma as the decimal separator', async () => {
        const { input, onChange, focus, clear, type, unmount } = await renderMoneyInput(0);
        await focus();
        await clear();
        await type('1,50');
        expect(input.value).toBe('150');
        expect(onChange).toHaveBeenLastCalledWith(15000);
        unmount();
    });

    it('rejects a second dot', async () => {
        const { input, focus, clear, type, unmount } = await renderMoneyInput(0);
        await focus();
        await clear();
        await type('1.2.3');
        expect(input.value).toBe('1.23');
        unmount();
    });
});
