import { AffixedInput } from '@/vdb/components/data-input/affixed-input.js';
import { Input } from '@/vdb/components/ui/input.js';
import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';

/**
 * @description
 * A component for displaying a text input.
 *
 * @docsCategory form-components
 * @docsPage TextInput
 */
export const TextInput: DashboardFormComponent = ({ value, onChange, fieldDef, disabled, ...rest }) => {
    const readOnly = isFieldDisabled(disabled, fieldDef);
    const prefix = fieldDef?.ui?.prefix;
    const suffix = fieldDef?.ui?.suffix;
    if (prefix || suffix) {
        return (
            <AffixedInput
                {...rest}
                fieldDef={fieldDef}
                value={value ?? ''}
                onChange={event => onChange(event.target.value)}
                disabled={readOnly}
                prefix={prefix}
                suffix={suffix}
            />
        );
    }
    return (
        <Input value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={readOnly} {...rest} />
    );
};
