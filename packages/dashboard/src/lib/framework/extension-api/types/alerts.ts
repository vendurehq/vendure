import { ComponentType } from 'react';

export type AlertSeverity = 'info' | 'warning' | 'error';

/**
 * @description
 * The props passed to an alert action's `onClick` handler or `component`.
 *
 * @docsCategory extensions-api
 * @docsPage Alerts
 * @since 3.6.0
 */
export interface AlertActionContext<TResponse = any> {
    data: TResponse;
    dismiss: () => void;
}

/**
 * @description
 * Defines an alert action. Either provide an `onClick` handler (rendered as a default button
 * with the given `label`), or a `component` for full control over rendering and hook access.
 *
 * @docsCategory extensions-api
 * @docsPage Alerts
 * @since 3.6.0
 */
export type DashboardAlertAction<TResponse = any> =
    | {
          label: string;
          onClick: (args: AlertActionContext<TResponse>) => void | Promise<any>;
          component?: never;
      }
    | {
          label?: string;
          onClick?: never;
          /**
           * @description
           * A React component to render as the action. This is useful when
           * the action needs access to React hooks (e.g. `useNavigate` from TanStack Router).
           *
           * The component receives the alert `data` and a `dismiss` function as props.
           *
           * @since 3.6.0
           */
          component: ComponentType<AlertActionContext<TResponse>>;
      };

/**
 * @description
 * Allows you to define custom alerts that can be displayed in the dashboard.
 *
 * @docsCategory extensions-api
 * @docsPage Alerts
 * @since 3.3.0
 */
export interface DashboardAlertDefinition<TResponse = any> {
    /**
     * @description
     * A unique identifier for the alert.
     */
    id: string;
    /**
     * @description
     * The title of the alert. Can be a string or a function that returns a string based on the response data.
     */
    title: string | ((data: TResponse) => string);
    /**
     * @description
     * The description of the alert. Can be a string or a function that returns a string based on the response data.
     */
    description?: string | ((data: TResponse) => string);
    /**
     * @description
     * The severity level of the alert.
     */
    severity: AlertSeverity | ((data: TResponse) => AlertSeverity);
    /**
     * @description
     * A function that checks the condition and returns the response data.
     */
    check: () => Promise<TResponse> | TResponse;
    /**
     * @description
     * A function that determines whether the alert should be rendered based on the response data.
     */
    shouldShow: (data: TResponse) => boolean;
    /**
     * @description
     * The interval in milliseconds to recheck the condition.
     */
    recheckInterval?: number;
    /**
     * @description
     * Optional actions that can be performed when the alert is shown.
     *
     * Each action is either a simple `onClick` handler (rendered as a default button
     * with the given `label`), or a `component` for full control over rendering and
     * access to React hooks.
     */
    actions?: Array<DashboardAlertAction<TResponse>>;
}
