import {
    DataDisplayComponent,
    useComponentRegistry,
} from '@/vdb/framework/component-registry/component-registry.js';
import { generateInputComponentKey } from '@/vdb/framework/extension-api/input-component-extensions.js';
import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';
import { usePageBlock } from '@/vdb/hooks/use-page-block.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { ControllerRenderProps, FieldPath, FieldValues } from 'react-hook-form';

export interface OverriddenFormComponent<
    TFieldValues extends FieldValues = any,
    TName extends FieldPath<TFieldValues> = any,
> {
    fieldName: string;
    field: ControllerRenderProps<TFieldValues, TName>;
    children?: React.ReactNode;
}

/**
 * @description
 * Based on the pageId and blockId of where this is placed, it will check whether any custom components
 * are registered and render them if so. Otherwise, it will render the children, which act as the
 * default if this location has not been overridden.
 *
 * ```tsx
 * <OverriddenFormComponent fieldName="myField" field={field}>
 *   <Input {...field} />
 * </OverriddenFormComponent>
 * ```
 */
export function OverriddenFormComponent({ fieldName, field, children }: Readonly<OverriddenFormComponent>) {
    const page = usePage();
    const pageBlock = usePageBlock({ optional: true });
    const componentRegistry = useComponentRegistry();
    let DisplayComponent: DataDisplayComponent | undefined;
    let InputComponent: DashboardFormComponent | undefined;
    if (page.pageId && pageBlock?.blockId) {
        const customInputComponentKey = generateInputComponentKey(page.pageId, pageBlock.blockId, fieldName);
        DisplayComponent = componentRegistry.getDisplayComponent(customInputComponentKey);
        InputComponent = componentRegistry.getInputComponent(customInputComponentKey);
    }
    if (DisplayComponent) {
        return <DisplayComponent {...field} />;
    }

    if (InputComponent) {
        return <InputComponent {...field} />;
    }
    return children ?? null;
}
