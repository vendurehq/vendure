import React, { PropsWithChildren } from 'react';

/**
 * @description
 * A wrapper around form fields which provides a label, tooltip and error message.
 *
 * @example
 * ```ts
 * import { FormField } from '@vendure/admin-ui/react';
 *
 * export function MyReactComponent() {
 *     return (
 *        <FormField label="My field" tooltip="This is a tooltip" invalid errorMessage="This field is invalid">
 *            <input type="text" />
 *        </FormField>
 *     );
 * }
 * ```
 *
 * @docsCategory react-components
 */
export function FormField(
    props: PropsWithChildren<{
        for?: string;
        label?: string;
        tooltip?: string;
        invalid?: boolean;
        errorMessage?: string;
    }>,
) {
    return (
        <div
            className={`form-group ` + (!props.label ? 'no-label' : '') + (props.invalid ? 'clr-error' : '')}
        >
            {props.label && <label htmlFor={props.for ?? ''}>{props.label}</label>}
            {props.tooltip && <div className="tooltip-text">{props.tooltip}</div>}
            <div className={`input-row ` + (props.invalid ? 'invalid' : '')}>{props.children}</div>
            {props.errorMessage && <div className="error-message">{props.errorMessage}</div>}
        </div>
    );
}
