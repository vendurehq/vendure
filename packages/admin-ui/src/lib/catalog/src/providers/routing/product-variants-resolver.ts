import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BaseEntityResolver, GetProductVariantOptionsQuery, DataService } from '@vendure/admin-ui/core';

@Injectable({
    providedIn: 'root',
})
export class ProductVariantsResolver extends BaseEntityResolver<GetProductVariantOptionsQuery['product']> {
    constructor(router: Router, dataService: DataService) {
        super(
            router,
            {
                __typename: 'Product' as const,
                id: '',
                createdAt: '',
                updatedAt: '',
                name: '',
                languageCode: '' as any,
                optionGroups: [],
                variants: [],
            },
            id => dataService.product.getProductVariantsOptions(id).mapStream(data => data.product),
        );
    }
}
