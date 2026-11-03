import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, OrderService, Permission, RequestContext } from '@vendure/core';

import { InvoicePdfService } from './invoice-pdf.service';

@Resolver()
export class InvoicePdfAdminResolver {
    constructor(
        private invoicePdfService: InvoicePdfService,
        private orderService: OrderService,
    ) {}

    @Mutation()
    @Allow(Permission.UpdateOrder)
    async generateInvoicePdf(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: string,
    ) {
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order) {
            throw new Error(`Order with id ${orderId} not found`);
        }

        const assetStorageStrategy = (ctx as any).assetStorageStrategy;
        if (!assetStorageStrategy) {
            throw new Error('AssetStorageStrategy not available');
        }

        const pdfUrl = await this.invoicePdfService.generateAndStore(ctx, order, assetStorageStrategy);

        const cf = (order as any).customFields;
        const invoiceNumber = cf?.invoiceNumber || `INV-${orderId}-${Date.now()}`;
        await this.orderService.updateCustomFields(ctx, orderId, {
            ...cf,
            invoicePdfUrl: pdfUrl,
            invoiceNumber,
        });

        return { url: pdfUrl, invoiceNumber };
    }
}
