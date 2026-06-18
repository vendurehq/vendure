import { getInputComponent } from '@/vdb/framework/extension-api/input-component-extensions.js';
import { DefaultInputForType } from '@/vdb/framework/form-engine/default-input-for-type.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';

const warnedComponents = new Set<string>();

export function CustomFormComponent(props: DashboardFormComponentProps) {
    if (!props.fieldDef) {
        return null;
    }
    const componentId = props.fieldDef.ui?.component;
    const Component = getInputComponent(componentId);

    if (!Component) {
        if (componentId && !warnedComponents.has(componentId)) {
            warnedComponents.add(componentId);
            console.warn(
                `Custom form component "${componentId}" not found for field "${props.fieldDef.name}". ` +
                    `Falling back to default input for type "${props.fieldDef.type}".`,
            );
        }
        return <DefaultInputForType {...props} />;
    }

    return <Component {...props} />;
}
