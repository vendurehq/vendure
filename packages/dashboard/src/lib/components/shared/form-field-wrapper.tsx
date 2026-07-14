import React from 'react';
import { Controller, ControllerProps, FieldPath, FieldValues } from 'react-hook-form';
import { OverriddenFormComponent } from '@/vdb/framework/form-engine/overridden-form-component.js';
import { LocationWrapper } from '@/vdb/framework/layout-engine/location-wrapper.js';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field.js';
import { applyControlProps } from './apply-control-props.js';

/**
 * @description
 * The props for the FormFieldWrapper component.
 *
 * @docsCategory form-components
 * @docsPage FormFieldWrapper
 * @since 3.4.0
 */
export type FormFieldWrapperProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = ControllerProps<TFieldValues, TName> & {
    /**
     * @description
     * The label for the form field.
     */
    label?: React.ReactNode;
    /**
     * @description
     * The description for the form field.
     */
    description?: React.ReactNode;
    /**
     * @description
     * Whether to inject `id` and `aria-invalid` props onto the rendered form control.
     * If false, the rendered element is used as-is without prop injection.
     * This is useful for components like `<Select/>` that manage their own trigger element.
     *
     * @default true
     */
    renderFormControl?: boolean;
};

/**
 * @description
 * This is a wrapper that can be used in all forms to wrap the actual form control, and provide a label, description and error message.
 *
 * Use this instead of raw Controller + Field primitives, as it also supports
 * overridden form components.
 *
 * @example
 * ```tsx
 * <PageBlock column="main" blockId="main-form">
 *     <DetailFormGrid>
 *         <FormFieldWrapper
 *             control={form.control}
 *             name="description"
 *             label={<Trans>Description</Trans>}
 *             render={({ field }) => <Input {...field} />}
 *         />
 *         <FormFieldWrapper
 *             control={form.control}
 *             name="code"
 *             label={<Trans>Code</Trans>}
 *             render={({ field }) => <Input {...field} />}
 *         />
 *     </DetailFormGrid>
 * </PageBlock>
 * ```
 *
 * If you are dealing with translatable fields, use the {@link TranslatableFormFieldWrapper} component instead.
 *
 * @docsCategory form-components
 * @docsPage FormFieldWrapper
 * @docsWeight 0
 * @since 3.4.0
 */
export function FormFieldWrapper<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
    label,
    description,
    renderFormControl = true,
    ...controllerProps
}: FormFieldWrapperProps<TFieldValues, TName>) {
    const { name, render, ...rest } = controllerProps;
    return (
        <LocationWrapper identifier={name}>
            <Controller
                {...rest}
                name={name}
                render={renderArgs => {
                    const { fieldState } = renderArgs;
                    const fieldId = `field-${name}`;
                    return (
                        <Field data-invalid={fieldState.invalid || undefined}>
                            {label && <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>}
                            <OverriddenFormComponent field={renderArgs.field} fieldName={name}>
                                {renderFormControl
                                    ? applyControlProps(render(renderArgs), {
                                          id: fieldId,
                                          'aria-invalid': fieldState.invalid || undefined,
                                      })
                                    : render(renderArgs)}
                            </OverriddenFormComponent>
                            {description && <FieldDescription>{description}</FieldDescription>}
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    );
                }}
            />
        </LocationWrapper>
    );
}
