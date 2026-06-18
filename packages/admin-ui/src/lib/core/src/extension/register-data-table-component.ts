import { inject, provideAppInitializer } from '@angular/core';
import {
    DataTableComponentConfig,
    DataTableCustomComponentService,
} from '../shared/components/data-table-2/data-table-custom-component.service';

/**
 * @description
 * Allows you to override the default component used to render the data of a particular column in a DataTable.
 * The component should implement the {@link CustomColumnComponent} interface. The tableId and columnId can
 * be determined by pressing `ctrl + u` when running the Admin UI in dev mode.
 *
 * @example
 * ```ts title="components/custom-table.component.ts"
 * import { Component, Input } from '\@angular/core';
 * import { CustomColumnComponent } from '\@vendure/admin-ui/core';
 *
 * \@Component({
 *     selector: 'custom-slug-component',
 *     template: `
 *         <a [href]="'https://example.com/products/' + rowItem.slug" target="_blank">{{ rowItem.slug }}</a>
 *     `,
 *     standalone: true,
 * })
 * export class CustomTableComponent implements CustomColumnComponent {
 *     \@Input() rowItem: any;
 * }
 * ```
 *
 * ```ts title="providers.ts"
 * import { registerDataTableComponent } from '\@vendure/admin-ui/core';
 * import { CustomTableComponent } from './components/custom-table.component';
 *
 * export default [
 *     registerDataTableComponent({
 *         component: CustomTableComponent,
 *         tableId: 'product-list',
 *         columnId: 'slug',
 *     }),
 * ];
 * ```
 *
 * @docsCategory custom-table-components
 */
export function registerDataTableComponent(config: DataTableComponentConfig) {
    return provideAppInitializer(() => {
        const initializerFn = ((dataTableCustomComponentService: DataTableCustomComponentService) => () => {
            dataTableCustomComponentService.registerCustomComponent(config);
        })(inject(DataTableCustomComponentService));
        return initializerFn();
    });
}
