import * as React from 'react';
import { Input as UiInput } from '@vendure-io/ui/components/atoms/input';

/**
 * Thin wrapper around the v2 `@vendure-io/ui` Input atom that null-coalesces
 * `value`. The v2 atom passes `value` straight through to the underlying control,
 * so a `null` field value triggers React's "value prop should not be null" warning
 * and a controlled→uncontrolled flip. Several dashboard routes render
 * `<Input {...field} />` where the react-hook-form `field.value` can be `null`, so
 * we coerce `null` (only) to an empty string here. `undefined` is preserved so
 * uncontrolled usages stay uncontrolled. See input.spec.tsx for the regression
 * tests, including confirmation that the v1 isDirty conflict no longer reproduces.
 */
function Input({ value, ...props }: React.ComponentProps<typeof UiInput>) {
    return <UiInput value={value === null ? '' : value} {...props} />;
}

export { Input };
