import React from 'react';

/**
 * Injects `id` and `aria-invalid` props onto the rendered element via cloneElement.
 * Used by FormFieldWrapper and TranslatableFormFieldWrapper to wire up
 * accessibility attributes without requiring the consumer to do it manually.
 *
 * When `nonBlank` is set, because the input field has the `@nonBlank` directive, it also adds
 * `required` and a `pattern` that rejects whitespace-only values, so the browser blocks the form
 * submit. Only rendered inputs are validated, so the empty translation rows the form seeds for
 * other languages do not block saving. An input opts out with `required={false}`.
 */
export function applyControlProps(
    element: React.ReactNode,
    props: Record<string, unknown>,
    nonBlank = false,
) {
    if (!React.isValidElement(element)) return element;
    const elementProps = element.props as Record<string, unknown>;
    return React.cloneElement(
        element as React.ReactElement<Record<string, unknown>>,
        nonBlank && elementProps.required !== false
            ? { required: true, pattern: String.raw`.*\S.*`, ...props }
            : props,
    );
}
