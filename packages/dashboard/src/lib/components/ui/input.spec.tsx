import * as React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Controller, useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Input as V2Input } from '@vendure-io/ui/components/atoms/input';

import { Input as DashboardInput } from './input.js';

// Regression coverage for the `input.tsx` wrapper (V2 migration decision 10).
//
// History: the dashboard forked the ui Input because v1 wrapped Base UI's
// `Field.Control`, which was reported to conflict with react-hook-form's `isDirty`
// tracking. On the v2 migration we re-tested that conflict empirically:
//
//  1. isDirty — the conflict NO LONGER reproduces. The raw v2 atom is not dirty on
//     mount and becomes dirty only on user edit (see "v2 atom (raw)" block below).
//  2. null value — the raw v2 atom STILL passes `value` straight through, so a
//     `null` field value emits React's "value prop should not be null" warning and
//     flips controlled→uncontrolled. Dashboard routes render `<Input {...field} />`
//     where `field.value` can be null, so this matters.
//
// Outcome: replace the full fork with a thin wrapper that ONLY null-coalesces
// `value` and otherwise delegates to the v2 atom. These tests lock in the wrapper's
// behaviour and document the raw-atom gap that justifies it — if a future v2 atom
// version null-coalesces itself, the "raw atom still warns on null" test will fail
// and signal that the wrapper can be dropped.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

/** Simulate real user typing into a (possibly controlled) input so React's onChange fires. */
function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function getInput(): HTMLInputElement {
    return container.querySelector('input') as HTMLInputElement;
}

function getDirty(): string {
    return (container.querySelector('[data-testid="dirty"]') as HTMLElement).textContent ?? '';
}

// React formats these with `%s` for the element name, so match on the stable
// phrasing rather than a literal `input`.
const NULL_CONTROLLED_WARNING = /should not be null|changing an? (un)?controlled input/;

type InputComponent = React.ComponentType<React.ComponentProps<'input'>>;

/** react-hook-form harness that mirrors the dashboard's `<Input {...field} />` usage. */
function DirtyHarness({ Input, defaultValue }: { Input: InputComponent; defaultValue: unknown }) {
    const {
        control,
        formState: { isDirty },
    } = useForm({ defaultValues: { name: defaultValue } as any });
    return (
        <>
            <span data-testid="dirty">{String(isDirty)}</span>
            <Controller
                name="name"
                control={control}
                render={({ field }) => <Input {...(field as any)} />}
            />
        </>
    );
}

function collectNullWarnings(render: () => void): string[] {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        render();
        return errorSpy.mock.calls
            .map(args => String(args[0]))
            .filter(msg => NULL_CONTROLLED_WARNING.test(msg));
    } finally {
        errorSpy.mockRestore();
    }
}

describe('Input (dashboard wrapper)', () => {
    it('is NOT dirty after mount with a non-empty default value', () => {
        act(() => {
            root.render(<DirtyHarness Input={DashboardInput} defaultValue="initial" />);
        });
        expect(getInput().value).toBe('initial');
        expect(getDirty()).toBe('false');
    });

    it('becomes dirty only after the user edits the field', () => {
        act(() => {
            root.render(<DirtyHarness Input={DashboardInput} defaultValue="initial" />);
        });
        expect(getDirty()).toBe('false');

        typeInto(getInput(), 'initial changed');
        expect(getDirty()).toBe('true');
    });

    it('does not warn when a react-hook-form field value is null', () => {
        const warnings = collectNullWarnings(() => {
            act(() => {
                root.render(<DirtyHarness Input={DashboardInput} defaultValue={null} />);
            });
            typeInto(getInput(), 'typed');
        });
        expect(warnings).toEqual([]);
        // Null was coerced to an empty string, so the field stayed controlled.
        expect(getInput().value).toBe('typed');
    });
});

describe('v2 atom (raw) — documents why the wrapper exists', () => {
    it('no longer reproduces the v1 isDirty conflict (clean on mount, dirty on edit)', () => {
        act(() => {
            root.render(<DirtyHarness Input={V2Input as InputComponent} defaultValue="initial" />);
        });
        expect(getDirty()).toBe('false');

        typeInto(getInput(), 'initial changed');
        expect(getDirty()).toBe('true');
    });

    it('still warns on a null field value (the gap the wrapper closes)', () => {
        const warnings = collectNullWarnings(() => {
            act(() => {
                root.render(<DirtyHarness Input={V2Input as InputComponent} defaultValue={null} />);
            });
        });
        expect(warnings.length).toBeGreaterThan(0);
    });
});
