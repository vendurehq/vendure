import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnDestroy,
    OnInit,
} from '@angular/core';
import { UntypedFormArray, UntypedFormGroup } from '@angular/forms';
import { Asset, Permission, ProductDetailFragment, ProductVariantFragment } from '@vendure/admin-ui/core';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';

interface SelectedAssets {
    assets?: Asset[];
    featuredAsset?: Asset;
}

interface PaginationConfig {
    totalItems: number;
    currentPage: number;
    itemsPerPage: number;
}

@Component({
    selector: 'vdr-product-variants-table',
    templateUrl: './product-variants-table.component.html',
    styleUrls: ['./product-variants-table.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ProductVariantsTableComponent implements OnInit, OnDestroy {
    @Input('productVariantsFormArray') formArray: UntypedFormArray;
    @Input() variants: ProductVariantFragment[];
    @Input() paginationConfig: PaginationConfig;
    @Input() channelPriceIncludesTax: boolean;
    @Input() optionGroups: ProductDetailFragment['optionGroups'];
    @Input() pendingAssetChanges: { [variantId: string]: SelectedAssets };
    formGroupMap = new Map<string, UntypedFormGroup>();
    readonly updatePermission = [Permission.UpdateCatalog, Permission.UpdateProduct];
    private subscription: Subscription;

    constructor(private changeDetector: ChangeDetectorRef) {}

    ngOnInit() {
        this.subscription = this.formArray.valueChanges
            .pipe(
                map(value => value.length),
                debounceTime(1),
                distinctUntilChanged(),
            )
            .subscribe(() => {
                this.buildFormGroupMap();
            });

        this.buildFormGroupMap();
    }

    ngOnDestroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

    trackByFn(index: number, item: any) {
        if ((item as any).id != null) {
            return (item as any).id;
        } else {
            return index;
        }
    }

    getFeaturedAsset(variant: ProductVariantFragment) {
        return this.pendingAssetChanges[variant.id]?.featuredAsset || variant.featuredAsset;
    }

    optionGroupName(optionGroupId: string): string | undefined {
        const group = this.optionGroups.find(g => g.id === optionGroupId);
        return group && group.name;
    }

    private buildFormGroupMap() {
        this.formGroupMap.clear();
        for (const controlGroup of this.formArray.controls) {
            this.formGroupMap.set(controlGroup.value.id, controlGroup as UntypedFormGroup);
        }
        this.changeDetector.markForCheck();
    }
}
