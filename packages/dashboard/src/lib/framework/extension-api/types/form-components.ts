import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';

/**
 * @description
 * Allows you to define a custom input component for custom fields and configurable operation arguments
 * in the dashboard. Register the component here, then reference its `id` from the field or argument
 * `ui.component` config.
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
 * Interface for registering custom input components which can be selected by custom fields and
 * configurable operation arguments via their `ui.component` config.
 *
 * @docsCategory extensions-api
 * @docsPage FormComponents
 * @since 3.4.0
 */
export interface DashboardCustomFormComponents {
    /**
     * @description
     * Custom input components for custom fields and configurable operation arguments.
     */
    customFields?: DashboardCustomFormComponent[];
}
