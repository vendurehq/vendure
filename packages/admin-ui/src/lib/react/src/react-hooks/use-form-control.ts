import { CustomFieldType } from '@vendure/common/lib/shared-types';
import { useContext, useEffect, useState } from 'react';
import { HostedComponentContext } from '../directives/react-component-host.directive';
import { HostedReactComponentContext, ReactFormInputOptions } from '../types';

/**
 * @description
 * Provides access to the current FormControl value and a method to update the value.
 *
 * @example
 * ```ts
 * import { useFormControl, ReactFormInputProps } from '\@vendure/admin-ui/react';
 * import React from 'react';
 *
 * export function ReactNumberInput({ readonly }: ReactFormInputProps) {
 *     const { value, setFormValue } = useFormControl();
 *
 *     const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
 *         setFormValue(val);
 *     };
 *     return (
 *         <div>
 *             <input readOnly={readonly} type="number" onChange={handleChange} value={value} />
 *         </div>
 *     );
 * }
 * ```
 *
 * @docsCategory react-hooks
 */
export function useFormControl() {
    const context = useContext(HostedComponentContext);
    if (!context) {
        throw new Error('No HostedComponentContext found');
    }
    if (!isFormInputContext(context)) {
        throw new Error('useFormControl() can only be used in a form input component');
    }
    const { formControl, config } = context;
    const [value, setValue] = useState(formControl.value ?? 0);

    useEffect(() => {
        const subscription = formControl.valueChanges.subscribe(v => {
            setValue(v);
        });
        return () => {
            subscription.unsubscribe();
        };
    }, []);

    function setFormValue(newValue: any) {
        formControl.setValue(coerceFormValue(newValue, config.type as CustomFieldType));
        formControl.markAsDirty();
    }

    return { value, setFormValue };
}

function isFormInputContext(
    context: HostedReactComponentContext,
): context is HostedReactComponentContext<ReactFormInputOptions> {
    return context.config && context.formControl;
}

function coerceFormValue(value: any, type: CustomFieldType) {
    switch (type) {
        case 'int':
        case 'float':
            return Number(value);
        case 'boolean':
            return Boolean(value);
        default:
            return value;
    }
}
