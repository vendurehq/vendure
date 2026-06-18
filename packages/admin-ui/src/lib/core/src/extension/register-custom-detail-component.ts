import { inject, provideAppInitializer } from '@angular/core';
import { CustomDetailComponentConfig } from '../providers/custom-detail-component/custom-detail-component-types';
import { CustomDetailComponentService } from '../providers/custom-detail-component/custom-detail-component.service';

/**
 * @description
 * Registers a {@link CustomDetailComponent} to be placed in a given location. This allows you
 * to embed any type of custom Angular component in the entity detail pages of the Admin UI.
 *
 * @example
 * ```ts
 * import { Component, OnInit } from '\@angular/core';
 * import { switchMap } from 'rxjs';
 * import { FormGroup } from '\@angular/forms';
 * import { CustomFieldConfig } from '\@vendure/common/lib/generated-types';
 * import {
 *     DataService,
 *     SharedModule,
 *     CustomDetailComponent,
 *     registerCustomDetailComponent,
 *     GetProductWithVariants
 * } from '\@vendure/admin-ui/core';
 *
 * \@Component({
 *     template: `{{ extraInfo$ | async | json }}`,
 *     standalone: true,
 *     imports: [SharedModule],
 * })
 * export class ProductInfoComponent implements CustomDetailComponent, OnInit {
 *     // These two properties are provided by Vendure and will vary
 *     // depending on the particular detail page you are embedding this
 *     // component into.
 *     entity$: Observable<GetProductWithVariants.Product>
 *     detailForm: FormGroup;
 *
 *     extraInfo$: Observable<any>;
 *
 *     constructor(private cmsDataService: CmsDataService) {}
 *
 *     ngOnInit() {
 *         this.extraInfo$ = this.entity$.pipe(
 *             switchMap(entity => this.cmsDataService.getDataFor(entity.id))
 *         );
 *     }
 * }
 *
 * export default [
 *     registerCustomDetailComponent({
 *         locationId: 'product-detail',
 *         component: ProductInfoComponent,
 *     }),
 * ];
 * ```
 *
 * @docsCategory custom-detail-components
 */
export function registerCustomDetailComponent(config: CustomDetailComponentConfig) {
    return provideAppInitializer(() => {
        const initializerFn = ((customDetailComponentService: CustomDetailComponentService) => () => {
            customDetailComponentService.registerCustomDetailComponent(config);
        })(inject(CustomDetailComponentService));
        return initializerFn();
    });
}
