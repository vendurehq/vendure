import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';

/**
 * @description
 * Allows you to define custom form components for custom fields in the dashboard.
 *
 * @docsCategory extensions-api
 * @docsPage FormComponents
 * @since 3.4.0
 */
export interface DashboardCustomFormComponent {
    /**
     * @description
     * A unique identifier for the custom form component. It is a good practice to namespace
     * these IDs to avoid naming collisions, for example `"my-plugin.markdown-editor"`.
     */
    id: string;
    /**
     * @description
     * The React component that will be rendered as the custom form input.
     */
    component: DashboardFormComponent;
}

/**
 * @description
 * Interface for registering custom field components in the dashboard.
 * For input and display components, use the co-located approach with detailForms.
 *
 * @docsCategory extensions-api
 * @docsPage FormComponents
 * @since 3.4.0
 */
export interface DashboardCustomFormComponents {
    /**
     * @description
     * Custom form components for custom fields. These are used when rendering
     * custom fields in forms.
     */
    customFields?: DashboardCustomFormComponent[];
}
