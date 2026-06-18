import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
    DataService,
    GetProductVariantsQuickJumpDocument,
    GetProductVariantsQuickJumpQuery,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';

const GET_PRODUCT_VARIANTS_QUICK_JUMP = gql`
    query GetProductVariantsQuickJump($id: ID!) {
        product(id: $id) {
            id
            variants {
                id
                name
                sku
            }
        }
    }
`;

@Component({
    selector: 'vdr-product-variant-quick-jump',
    templateUrl: './product-variant-quick-jump.component.html',
    styleUrls: ['./product-variant-quick-jump.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ProductVariantQuickJumpComponent implements OnInit {
    @Input() productId: string;
    selectedVariantId: string | undefined;
    variants$: Observable<NonNullable<GetProductVariantsQuickJumpQuery['product']>['variants']>;
    constructor(
        private dataService: DataService,
        private router: Router,
    ) {}

    ngOnInit() {
        this.variants$ = this.dataService
            .query(GetProductVariantsQuickJumpDocument, {
                id: this.productId,
            })
            .mapStream(data => data.product?.variants ?? []);
    }

    searchFn = (
        term: string,
        item: NonNullable<GetProductVariantsQuickJumpQuery['product']>['variants'][number],
    ) =>
        item.name.toLowerCase().includes(term.toLowerCase()) ||
        item.sku.toLowerCase().includes(term.toLowerCase());

    onSelect(item?: NonNullable<GetProductVariantsQuickJumpQuery['product']>['variants'][number]) {
        if (item) {
            this.router
                .navigate(['catalog', 'products', this.productId, 'variants', item.id])
                .then(() => (this.selectedVariantId = undefined));
        }
    }
}
