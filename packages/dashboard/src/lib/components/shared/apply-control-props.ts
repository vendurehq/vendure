import React from 'react';

/**
 * Injects `id` and `aria-invalid` props onto the rendered element via cloneElement.
 * Used by FormFieldWrapper and TranslatableFormFieldWrapper to wire up
 * accessibility attributes without requiring the consumer to do it manually.
 */
export function applyControlProps(element: React.ReactNode, props: Record<string, unknown>) {
    if (!React.isValidElement(element)) return element;
    return React.cloneElement(element as React.ReactElement<Record<string, unknown>>, props);
}
