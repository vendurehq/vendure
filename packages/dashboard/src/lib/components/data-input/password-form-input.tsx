import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isReadonlyField } from '@/vdb/framework/form-engine/utils.js';
import { PasswordInput } from '../ui/password-input.js';

/**
 * @description
 * A component for displaying a password input.
 *
 * @docsCategory form-components
 * @docsPage PasswordInput
 */
export function PasswordFormInput({
    value,
    onChange,
    fieldDef,
    disabled,
    ...rest
}: Readonly<DashboardFormComponentProps>) {
    const readOnly = disabled || isReadonlyField(fieldDef);
    return (
        <PasswordInput
            {...rest}
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={readOnly}
        />
    );
}
