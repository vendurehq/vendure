import { Checkbox } from '../ui/checkbox.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';

/**
 * @description
 * Displays a boolean value as a checkbox.
 *
 * @docsCategory form-components
 * @docsPage CheckboxInput
 */
export function CheckboxInput({ value, onChange, fieldDef, disabled }: Readonly<DashboardFormComponentProps>) {
    const readOnly = isFieldDisabled(disabled, fieldDef);
    return <Checkbox checked={value} onCheckedChange={onChange} disabled={readOnly} />;
}
