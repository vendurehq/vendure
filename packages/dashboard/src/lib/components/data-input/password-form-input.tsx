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
export function PasswordFormInput(props: Readonly<DashboardFormComponentProps>) {
    const readOnly = props.disabled || isReadonlyField(props.fieldDef);
    return (
        <PasswordInput
            ref={props.ref}
            value={props.value}
            onChange={e => props.onChange(e.target.value)}
            disabled={readOnly}
        />
    );
}
