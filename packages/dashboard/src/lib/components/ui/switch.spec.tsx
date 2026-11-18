import { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Switch } from './switch.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no PointerEvent; Base UI dispatches one when the switch is clicked.
if (!(window as any).PointerEvent) {
    (window as any).PointerEvent = class extends MouseEvent {};
}

let container: HTMLDivElement;
let root: Root;
let setChecked: (value: boolean) => void = () => undefined;

function Harness({ initial }: Readonly<{ initial: boolean }>) {
    const [checked, set] = useState(initial);
    setChecked = set;
    return <Switch checked={checked} onCheckedChange={set} />;
}

function getSwitch() {
    return container.querySelector<HTMLElement>('[data-slot="switch"]')!;
}

function isStill() {
    return getSwitch().className.split(' ').includes('transition-none');
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

// OSS-1316 — a switch moves only when the user flips it
describe('Switch motion', () => {
    it('does not animate a value that arrives without a user toggle', () => {
        act(() => root.render(<Harness initial={false} />));
        expect(isStill()).toBe(true);
        act(() => setChecked(true));
        expect(getSwitch().hasAttribute('data-checked')).toBe(true);
        expect(isStill()).toBe(true);
    });

    it('animates a user toggle', () => {
        act(() => root.render(<Harness initial={false} />));
        act(() => getSwitch().click());
        expect(getSwitch().hasAttribute('data-checked')).toBe(true);
        expect(isStill()).toBe(false);
    });

    it('stops animating again when a later change does not come from the user', () => {
        act(() => root.render(<Harness initial={false} />));
        act(() => getSwitch().click());
        act(() => setChecked(false));
        expect(getSwitch().hasAttribute('data-unchecked')).toBe(true);
        expect(isStill()).toBe(true);
    });
});
