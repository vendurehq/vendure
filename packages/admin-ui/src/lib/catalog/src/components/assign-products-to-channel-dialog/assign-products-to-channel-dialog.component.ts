import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    Dialog,
    GetChannelsQuery,
    ItemOf,
    LogicalOperator,
    NotificationService,
} from '@vendure/admin-ui/core';
import { combineLatest, from, lastValueFrom, Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

type Channel = ItemOf<GetChannelsQuery, 'channels'>;

@Component({
    selector: 'vdr-assign-products-to-channel-dialog',
    templateUrl: './assign-products-to-channel-dialog.component.html',
    styleUrls: ['./assign-products-to-channel-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class AssignProductsToChannelDialogComponent implements OnInit, Dialog<any> {
    selectedChannel: Channel | null | undefined;
    currentChannel: Channel;
    availableChannels: Channel[];
    resolveWith: (result?: any) => void;
    variantsPreview$: Observable<Array<{ id: string; name: string; price: number; pricePreview: number }>>;
    priceFactorControl = new UntypedFormControl(1);
    selectedChannelIdControl = new UntypedFormControl();

    // assigned by ModalService.fromComponent() call
    productIds: string[];
    productVariantIds: string[] | undefined;
    currentChannelIds: string[];

    get isProductVariantMode(): boolean {
        return this.productVariantIds != null;
    }

    constructor(private dataService: DataService, private notificationService: NotificationService) {}

    ngOnInit() {
        const activeChannelId$ = this.dataService.client
            .userStatus()
            .mapSingle(({ userStatus }) => userStatus.activeChannelId);
        const allChannels$ = this.dataService.settings.getChannels().mapSingle(data => data.channels);

        combineLatest(activeChannelId$, allChannels$).subscribe(([activeChannelId, channels]) => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.currentChannel = channels.items.find(c => c.id === activeChannelId)!;
            this.availableChannels = channels.items;
        });

        this.selectedChannelIdControl.valueChanges.subscribe(ids => {
            this.selectChannel(ids);
        });

        this.variantsPreview$ = combineLatest(
            from(this.getTopVariants(10)),
            this.priceFactorControl.valueChanges.pipe(startWith(1)),
        ).pipe(
            map(([variants, factor]) =>
                variants.map(v => ({
                    id: v.id,
                    name: v.name,
                    price: v.price,
                    pricePreview: v.price * +factor,
                })),
            ),
        );
    }

    selectChannel(channelIds: string[]) {
        this.selectedChannel = this.availableChannels.find(c => c.id === channelIds[0]);
    }

    assign() {
        const selectedChannel = this.selectedChannel;
        if (selectedChannel) {
            if (!this.isProductVariantMode) {
                this.dataService.product
                    .assignProductsToChannel({
                        channelId: selectedChannel.id,
                        productIds: this.productIds,
                        priceFactor: +this.priceFactorControl.value,
                    })
                    .subscribe(() => {
                        this.notificationService.success(_('catalog.assign-product-to-channel-success'), {
                            channel: selectedChannel.code,
                            count: this.productIds.length,
                        });
                        this.resolveWith(true);
                    });
            } else if (this.productVariantIds) {
                this.dataService.product
                    .assignVariantsToChannel({
                        channelId: selectedChannel.id,
                        productVariantIds: this.productVariantIds,
                        priceFactor: +this.priceFactorControl.value,
                    })
                    .subscribe(() => {
                        this.notificationService.success(_('catalog.assign-variant-to-channel-success'), {
                            channel: selectedChannel.code,
                            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                            count: this.productVariantIds!.length,
                        });
                        this.resolveWith(true);
                    });
            }
        }
    }

    cancel() {
        this.resolveWith();
    }

    private async getTopVariants(take: number) {
        return (
            await lastValueFrom(
                this.dataService.product.getProductVariants({
                    filterOperator: LogicalOperator.OR,
                    filter: {
                        productId: { in: this.productIds },
                        id: { in: this.productVariantIds },
                    },
                    take,
                }).single$,
            )
        ).productVariants.items;
    }
}
