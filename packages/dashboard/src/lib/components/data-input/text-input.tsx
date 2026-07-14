// Simple built-in components using the single DashboardFormComponent interface
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
    return <Input value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={readOnly} {...rest} />;
};
