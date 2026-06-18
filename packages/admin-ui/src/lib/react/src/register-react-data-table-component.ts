import { inject, provideAppInitializer } from '@angular/core';
import {
    DataTableColumnId,
    DataTableCustomComponentService,
    DataTableLocationId,
} from '@vendure/admin-ui/core';
import { ElementType } from 'react';
import {
    REACT_CUSTOM_COLUMN_COMPONENT_OPTIONS,
    ReactCustomColumnComponent,
} from './components/react-custom-column.component';

/**
 * @description
 * Configures a {@link CustomDetailComponent} to be placed in the given location.
 *
 * @docsCategory react-extensions
 */
export interface ReactDataTableComponentConfig {
    /**
     * @description
     * The location in the UI where the custom component should be placed.
     */
    tableId: DataTableLocationId;
    /**
     * @description
     * The column in the table where the custom component should be placed.
     */
    columnId: DataTableColumnId;
    /**
     * @description
     * The component to render in the table cell. This component will receive the `rowItem` prop
     * which is the data object for the row, e.g. the `Product` object if used in the `product-list` table.
     */
    component: ElementType;
    /**
     * @description
     * Optional props to pass to the React component.
     */
    props?: Record<string, any>;
}

/**
 * @description
 * The props that will be passed to the React component registered via {@link registerReactDataTableComponent}.
 */
export interface ReactDataTableComponentProps<T = any> {
    rowItem: T;
    [prop: string]: any;
}

/**
 * @description
 * Registers a React component to be rendered in a data table in the given location.
 * The component will receive the `rowItem` prop which is the data object for the row,
 * e.g. the `Product` object if used in the `product-list` table.
 *
 * @example
 * ```ts title="components/SlugWithLink.tsx"
 * import { ReactDataTableComponentProps } from '\@vendure/admin-ui/react';
 * import React from 'react';
 *
 * export function SlugWithLink({ rowItem }: ReactDataTableComponentProps<{ slug: string }>) {
 *     return (
 *         <a href={`https://example.com/products/${rowItem.slug}`} target="_blank">
 *             {rowItem.slug}
 *         </a>
 *     );
 * }
 * ```
 *
 * ```ts title="providers.ts"
 * import { registerReactDataTableComponent } from '\@vendure/admin-ui/react';
 * import { SlugWithLink } from './components/SlugWithLink';
 *
 * export default [
 *     registerReactDataTableComponent({
 *         component: SlugWithLink,
 *         tableId: 'product-list',
 *         columnId: 'slug',
 *         props: {
 *           foo: 'bar',
 *         },
 *     }),
 * ];
 * ```
 *
 * @docsCategory react-extensions
 */
export function registerReactDataTableComponent(config: ReactDataTableComponentConfig) {
    return provideAppInitializer(() => {
        const initializerFn = ((dataTableCustomComponentService: DataTableCustomComponentService) => () => {
            dataTableCustomComponentService.registerCustomComponent({
                ...config,
                component: ReactCustomColumnComponent,
                providers: [
                    {
                        provide: REACT_CUSTOM_COLUMN_COMPONENT_OPTIONS,
                        useValue: {
                            component: config.component,
                            props: config.props,
                        },
                    },
                ],
            });
        })(inject(DataTableCustomComponentService));
        return initializerFn();
      });
}
