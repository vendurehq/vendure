import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import {
    allCustomFieldsFragment,
    booleanCustomFieldFragment,
    customFieldConfigFragment,
    dateTimeCustomFieldFragment,
    floatCustomFieldFragment,
    intCustomFieldFragment,
    localeStringCustomFieldFragment,
    localeTextCustomFieldFragment,
    relationCustomFieldFragment,
    stringCustomFieldFragment,
    structCustomFieldFragment,
    textCustomFieldFragment,
} from '@/vdb/providers/server-config.js';
import { ResultOf } from 'gql.tada';
import React from 'react';
import { ControllerRenderProps, FieldPath, FieldValues } from 'react-hook-form';

// Base custom field config
export type CustomFieldConfig = ResultOf<typeof customFieldConfigFragment>;

// Individual custom field type configurations
export type StringCustomFieldConfig = ResultOf<typeof stringCustomFieldFragment>;
export type LocaleStringCustomFieldConfig = ResultOf<typeof localeStringCustomFieldFragment>;
export type TextCustomFieldConfig = ResultOf<typeof textCustomFieldFragment>;
export type LocaleTextCustomFieldConfig = ResultOf<typeof localeTextCustomFieldFragment>;
export type BooleanCustomFieldConfig = ResultOf<typeof booleanCustomFieldFragment>;
export type IntCustomFieldConfig = ResultOf<typeof intCustomFieldFragment>;
export type FloatCustomFieldConfig = ResultOf<typeof floatCustomFieldFragment>;
export type DateTimeCustomFieldConfig = ResultOf<typeof dateTimeCustomFieldFragment>;
export type RelationCustomFieldConfig = ResultOf<typeof relationCustomFieldFragment>;
export type StructCustomFieldConfig = ResultOf<typeof structCustomFieldFragment>;

// Union type of all custom field configs
export type AllCustomFieldConfigs = ResultOf<typeof allCustomFieldsFragment>;

// Configurable operation argument definition
export type ConfigurableArgDef = ResultOf<typeof configurableOperationDefFragment>['args'][number];

// Union type for all field definitions
export type ConfigurableFieldDef = AllCustomFieldConfigs | ConfigurableArgDef;

// Struct field types (used within struct custom fields)
export type StructField = StructCustomFieldConfig['fields'][number];

// Individual struct field type configurations (for type guards)
export type StringStructField = Extract<StructField, { type: 'string' }>;
export type IntStructField = Extract<StructField, { type: 'int' }>;
export type FloatStructField = Extract<StructField, { type: 'float' }>;
export type BooleanStructField = Extract<StructField, { type: 'boolean' }>;
export type DateTimeStructField = Extract<StructField, { type: 'datetime' }>;

/**
 * @description
 * Props that get passed to all form input components. They are based on the
 * controller props used by the underlying `react-hook-form`, i.e.:
 *
 * ```ts
 * export type ControllerRenderProps = {
 *     onChange: (event: any) => void;
 *     onBlur: () => void;
 *     value: any;
 *     disabled?: boolean;
 *     name: string;
 *     ref: RefCallBack;
 * };
 * ```
 *
 * in addition, they can optionally be passed a `fieldDef` prop if the
 * component is used in the context of a custom field or configurable operation arg.
 *
 * The `fieldDef` arg, when present, has the following shape:
 *
 * ```ts
 * export type ConfigurableArgDef = {
 *     defaultValue: any
 *     description: string | null
 *     label: string | null
 *     list: boolean
 *     name: string
 *     required: boolean
 *     type: string
 *     ui: any
 * }
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage FormComponents
 * @since 3.4.0
 */
export type DashboardFormComponentProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = ControllerRenderProps<TFieldValues, TName> & {
    fieldDef?: ConfigurableFieldDef;
};

/**
 * @description
 * Metadata which can be defined on a {@link DashboardFormComponent} which
 * provides additional information about how the dashboard should render the
 * component.
 *
 * The metadata is defined by adding the static property on the component:
 *
 * @example
 * ```ts
 * export const MyCustomInput: DashboardFormComponent = props => {
 *   // implementation omitted
 * }
 *
 * MyCustomInput.metadata = { // [!code highlight]
 *   isListInput: true // [!code highlight]
 * } // [!code highlight]
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage FormComponents
 * @since 3.4.0
 */
export type DashboardFormComponentMetadata = {
    /**
     * @description
     * Defines whether this form component is designed to handle list inputs.
     * If set to `'dynamic'`, it means the component has internal logic that can
     * handle both lists and single values.
     */
    isListInput?: boolean | 'dynamic';
    /**
     * @description
     * When true, the dashboard will render this form component so it spans
     * the full width of the detail form grid.
     */
    isFullWidth?: boolean;
};

/**
 * @description
 * This is the common type for all custom form components registered for:
 *
 * - custom fields
 * - configurable operation args
 * - detail page fields
 *
 * Here's a simple example:
 *
 * ```ts
 * import { DashboardFormComponent, Input } from '\@vendure/dashboard';
 *
 * const MyComponent: DashboardFormComponent = (props) => {
 *     return <Input value={props.value}
 *                   onChange={props.onChange}
 *                   onBlur={props.onBlur}
 *                   name={props.name}
 *                   disabled={props.disabled}
 *                   ref={props.ref}
 *                   />;
 * };
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage FormComponents
 * @since 3.4.0
 */
export type DashboardFormComponent = React.ComponentType<DashboardFormComponentProps> & {
    metadata?: DashboardFormComponentMetadata;
};
