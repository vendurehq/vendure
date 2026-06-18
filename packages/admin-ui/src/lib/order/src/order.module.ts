import { NgModule } from '@angular/core';
import { RouterModule, ROUTES } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    detailComponentWithResolver,
    OrderDetailQueryDocument,
    OrderType,
    PageService,
    SharedModule,
} from '@vendure/admin-ui/core';

import { AddManualPaymentDialogComponent } from './components/add-manual-payment-dialog/add-manual-payment-dialog.component';
import { CancelOrderDialogComponent } from './components/cancel-order-dialog/cancel-order-dialog.component';
import { CouponCodeSelectorComponent } from './components/coupon-code-selector/coupon-code-selector.component';
import { DraftOrderDetailComponent } from './components/draft-order-detail/draft-order-detail.component';
import { DraftOrderVariantSelectorComponent } from './components/draft-order-variant-selector/draft-order-variant-selector.component';
import { FulfillOrderDialogComponent } from './components/fulfill-order-dialog/fulfill-order-dialog.component';
import { FulfillmentCardComponent } from './components/fulfillment-card/fulfillment-card.component';
import { FulfillmentDetailComponent } from './components/fulfillment-detail/fulfillment-detail.component';
import { FulfillmentStateLabelComponent } from './components/fulfillment-state-label/fulfillment-state-label.component';
import { LineFulfillmentComponent } from './components/line-fulfillment/line-fulfillment.component';
import { LineRefundsComponent } from './components/line-refunds/line-refunds.component';
import { ModificationDetailComponent } from './components/modification-detail/modification-detail.component';
import { OrderCustomFieldsCardComponent } from './components/order-custom-fields-card/order-custom-fields-card.component';
import { OrderTotalColumnComponent } from './components/order-data-table/order-total-column.component';
import { OrderDetailComponent } from './components/order-detail/order-detail.component';
import { OrderEditorComponent } from './components/order-editor/order-editor.component';
import { OrderEditsPreviewDialogComponent } from './components/order-edits-preview-dialog/order-edits-preview-dialog.component';
import { OrderHistoryEntryHostComponent } from './components/order-history/order-history-entry-host.component';
import { OrderHistoryComponent } from './components/order-history/order-history.component';
import { OrderListComponent } from './components/order-list/order-list.component';
import { OrderPaymentCardComponent } from './components/order-payment-card/order-payment-card.component';
import { OrderProcessGraphDialogComponent } from './components/order-process-graph-dialog/order-process-graph-dialog.component';
import { OrderProcessEdgeComponent } from './components/order-process-graph/order-process-edge.component';
import { OrderProcessGraphComponent } from './components/order-process-graph/order-process-graph.component';
import { OrderProcessNodeComponent } from './components/order-process-graph/order-process-node.component';
import { OrderStateSelectDialogComponent } from './components/order-state-select-dialog/order-state-select-dialog.component';
import { OrderTableComponent } from './components/order-table/order-table.component';
import { PaymentDetailComponent } from './components/payment-detail/payment-detail.component';
import { PaymentStateLabelComponent } from './components/payment-state-label/payment-state-label.component';
import { RefundDetailComponent } from './components/refund-detail/refund-detail.component';
import { RefundOrderDialogComponent } from './components/refund-order-dialog/refund-order-dialog.component';
import { RefundStateLabelComponent } from './components/refund-state-label/refund-state-label.component';
import { SelectAddressDialogComponent } from './components/select-address-dialog/select-address-dialog.component';
import { SelectCustomerDialogComponent } from './components/select-customer-dialog/select-customer-dialog.component';
import { SelectShippingMethodDialogComponent } from './components/select-shipping-method-dialog/select-shipping-method-dialog.component';
import { SellerOrdersCardComponent } from './components/seller-orders-card/seller-orders-card.component';
import { SettleRefundDialogComponent } from './components/settle-refund-dialog/settle-refund-dialog.component';
import { SimpleItemListComponent } from './components/simple-item-list/simple-item-list.component';
import { createRoutes } from './order.routes';
import { OrderDataTableComponent } from './components/order-data-table/order-data-table.component';
import { PaymentForRefundSelectorComponent } from './components/payment-for-refund-selector/payment-for-refund-selector.component';
import { OrderModificationSummaryComponent } from './components/order-modification-summary/order-modification-summary.component';

@NgModule({
    imports: [SharedModule, RouterModule.forChild([])],
    providers: [
        {
            provide: ROUTES,
            useFactory: (pageService: PageService) => createRoutes(pageService),
            multi: true,
            deps: [PageService],
        },
    ],
    declarations: [
        OrderListComponent,
        OrderDetailComponent,
        FulfillOrderDialogComponent,
        LineFulfillmentComponent,
        RefundOrderDialogComponent,
        CancelOrderDialogComponent,
        PaymentStateLabelComponent,
        LineRefundsComponent,
        OrderPaymentCardComponent,
        RefundStateLabelComponent,
        SettleRefundDialogComponent,
        OrderHistoryComponent,
        FulfillmentDetailComponent,
        PaymentDetailComponent,
        SimpleItemListComponent,
        OrderCustomFieldsCardComponent,
        OrderProcessGraphComponent,
        OrderProcessNodeComponent,
        OrderProcessEdgeComponent,
        OrderProcessGraphDialogComponent,
        FulfillmentStateLabelComponent,
        FulfillmentCardComponent,
        OrderEditorComponent,
        OrderTableComponent,
        OrderEditsPreviewDialogComponent,
        ModificationDetailComponent,
        AddManualPaymentDialogComponent,
        OrderStateSelectDialogComponent,
        DraftOrderDetailComponent,
        DraftOrderVariantSelectorComponent,
        SelectCustomerDialogComponent,
        SelectAddressDialogComponent,
        CouponCodeSelectorComponent,
        SelectShippingMethodDialogComponent,
        OrderHistoryEntryHostComponent,
        SellerOrdersCardComponent,
        OrderDataTableComponent,
        OrderTotalColumnComponent,
        PaymentForRefundSelectorComponent,
        OrderModificationSummaryComponent,
        RefundDetailComponent,
    ],
    exports: [OrderCustomFieldsCardComponent],
})
export class OrderModule {
    private static hasRegisteredTabsAndBulkActions = false;

    constructor(pageService: PageService) {
        if (OrderModule.hasRegisteredTabsAndBulkActions) {
            return;
        }
        pageService.registerPageTab({
            priority: 0,
            location: 'order-list',
            tab: _('order.orders'),
            route: '',
            component: OrderListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'order-detail',
            tab: _('order.order'),
            route: '',
            component: detailComponentWithResolver({
                component: OrderDetailComponent,
                query: OrderDetailQueryDocument,
                entityKey: 'order',
                getBreadcrumbs: entity =>
                    entity?.type !== OrderType.Seller || !entity?.aggregateOrder
                        ? [
                              {
                                  label: `${entity?.code}`,
                                  link: [entity?.id],
                              },
                          ]
                        : [
                              {
                                  label: `${entity?.aggregateOrder?.code}`,
                                  link: ['/orders/', entity?.aggregateOrder?.id],
                              },
                              {
                                  label: _('breadcrumb.seller-orders'),
                                  link: ['/orders/', entity?.aggregateOrder?.id],
                              },
                              {
                                  label: `${entity?.code}`,
                                  link: [entity?.id],
                              },
                          ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'draft-order-detail',
            tab: _('order.order'),
            route: '',
            component: detailComponentWithResolver({
                component: DraftOrderDetailComponent,
                query: OrderDetailQueryDocument,
                entityKey: 'order',
                getBreadcrumbs: entity => [
                    {
                        label: _('order.draft-order'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'modify-order',
            tab: _('order.order'),
            route: '',
            component: detailComponentWithResolver({
                component: OrderEditorComponent,
                query: OrderDetailQueryDocument,
                entityKey: 'order',
                getBreadcrumbs: entity => [
                    {
                        label: entity?.code || 'order',
                        link: ['/orders/', entity?.id],
                    },
                    {
                        label: _('breadcrumb.modifying-order'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        OrderModule.hasRegisteredTabsAndBulkActions = true;
    }
}
