import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';
import { DocumentNode } from 'graphql';

/**
 * @description
 * Allows you to define custom input components for specific fields in detail forms.
 * The pageId is already defined in the detail form extension, so only the blockId and field are needed.
 *
 * @docsCategory extensions-api
 * @docsPage DetailForms
 * @since 3.4.0
 */
export interface DashboardDetailFormInputComponent {
    /**
     * @description
     * The ID of the block where this input component should be used.
     */
    blockId: string;
    /**
     * @description
     * The name of the field where this input component should be used.
     */
    field: string;
    /**
     * @description
     * The React component that will be rendered as the input.
     * It should accept `value`, `onChange`, and other standard input props.
     */
    component: DashboardFormComponent;
}

/**
 * @description
 * Allows you to extend existing detail forms (e.g. on the product detail or customer detail pages)
 * with custom GraphQL queries, input components, and display components.
 *
 * @since 3.4.0
 * @docsPage DetailForms
 * @docsCategory extensions-api
 */
export interface DashboardDetailFormExtensionDefinition {
    /**
     * @description
     * The ID of the page where the detail form is located, e.g. `'product-detail'`, `'order-detail'`.
     */
    pageId: string;
    /**
     * @description
     * Extends the GraphQL query used to fetch data for the detail page, allowing you to add additional
     * fields that can be used by custom input or display components.
     */
    extendDetailDocument?: string | DocumentNode | (() => DocumentNode | string);
    /**
     * @description
     * Custom input components for specific fields in the detail form.
     */
    inputs?: DashboardDetailFormInputComponent[];
}
