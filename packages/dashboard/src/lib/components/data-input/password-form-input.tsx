import { Input } from '@/vdb/components/ui/input.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isReadonlyField, isRedactedSecretValue } from '@/vdb/framework/form-engine/utils.js';
import { useLingui } from '@lingui/react/macro';
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
    const { t } = useLingui();
    const readOnly = disabled || isReadonlyField(fieldDef);

    // A secret the current user is not permitted to read comes back from the API as a redaction
    // placeholder. That sentinel must never be shown (revealing it would just display the raw token),
    // so it is rendered as a neutral, read-only "hidden" field with no reveal toggle. The placeholder
    // stays as the form value, so saving the entity round-trips it and preserves the stored secret.
    if (isRedactedSecretValue(value)) {
        return (
            <Input
                {...rest}
                readOnly
                value=""
                placeholder={t`Hidden — you do not have permission to view this value`}
            />
        );
    }

    return (
        <PasswordInput
            {...rest}
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={readOnly}
        />
    );
}
