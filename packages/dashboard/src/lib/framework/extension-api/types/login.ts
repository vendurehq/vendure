import type React from 'react';

/**
 * @description
 * Defines a custom logo component for the login page.
 *
 * @docsCategory extensions-api
 * @docsPage Login
 * @since 3.4.0
 */
export interface LoginLogoExtension {
    /**
     * @description
     * A React component that will replace the default Vendure logo.
     */
    component: React.ComponentType;
}

/**
 * @description
 * Defines content to display before the login form.
 *
 * @docsCategory extensions-api
 * @docsPage Login
 * @since 3.4.0
 */
export interface LoginBeforeFormExtension {
    /**
     * @description
     * A React component that will be rendered before the login form.
     */
    component: React.ComponentType;
}

/**
 * @description
 * Defines content to display after the login form.
 *
 * @docsCategory extensions-api
 * @docsPage Login
 * @since 3.4.0
 */
export interface LoginAfterFormExtension {
    /**
     * @description
     * A React component that will be rendered after the login form.
     */
    component: React.ComponentType;
}

/**
 * @description
 * Defines all available login page extensions.
 *
 * @docsCategory extensions-api
 * @docsPage Login
 * @docsWeight 0
 * @since 3.4.0
 */
export interface DashboardLoginExtensions {
    /**
     * @description
     * Custom logo component to replace the default Vendure logo.
     */
    logo?: LoginLogoExtension;
    /**
     * @description
     * Component to render before the login form.
     */
    beforeForm?: LoginBeforeFormExtension;
    /**
     * @description
     * Component to render after the login form.
     */
    afterForm?: LoginAfterFormExtension;
}
