import { Injectable } from '@nestjs/common';
import { UpdateCustomerInput as UpdateCustomerShopInput } from '@vendure/common/lib/generated-shop-types';
import {
    CurrencyCode,
    HistoryEntryListOptions,
    HistoryEntryType,
    OrderLineInput,
    UpdateAddressInput,
    UpdateCustomerInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList, Type } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Administrator } from '../../entity/administrator/administrator.entity';
import { CustomerHistoryEntry } from '../../entity/history-entry/customer-history-entry.entity';
import { HistoryEntry } from '../../entity/history-entry/history-entry.entity';
import { OrderHistoryEntry } from '../../entity/history-entry/order-history-entry.entity';
import { EventBus } from '../../event-bus';
import { HistoryEntryEvent } from '../../event-bus/events/history-entry-event';
import { FulfillmentState } from '../helpers/fulfillment-state-machine/fulfillment-state';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { OrderState } from '../helpers/order-state-machine/order-state';
import { PaymentState } from '../helpers/payment-state-machine/payment-state';
import { RefundState } from '../helpers/refund-state-machine/refund-state';

import { AdministratorService } from './administrator.service';
export interface CustomerHistoryEntryData {
    [HistoryEntryType.CUSTOMER_REGISTERED]: {
        strategy: string;
    };
    [HistoryEntryType.CUSTOMER_VERIFIED]: {
        strategy: string;
    };
    [HistoryEntryType.CUSTOMER_DETAIL_UPDATED]: {
        input: UpdateCustomerInput | UpdateCustomerShopInput;
    };
    [HistoryEntryType.CUSTOMER_ADDRESS_CREATED]: {
        address: string;
    };
    [HistoryEntryType.CUSTOMER_ADDED_TO_GROUP]: {
        groupName: string;
    };
    [HistoryEntryType.CUSTOMER_REMOVED_FROM_GROUP]: {
        groupName: string;
    };
    [HistoryEntryType.CUSTOMER_ADDRESS_UPDATED]: {
        address: string;
        input: UpdateAddressInput;
    };
    [HistoryEntryType.CUSTOMER_ADDRESS_DELETED]: {
        address: string;
    };
    [HistoryEntryType.CUSTOMER_PASSWORD_UPDATED]: Record<string, never>;
    [HistoryEntryType.CUSTOMER_PASSWORD_RESET_REQUESTED]: Record<string, never>;
    [HistoryEntryType.CUSTOMER_PASSWORD_RESET_VERIFIED]: Record<string, never>;
    [HistoryEntryType.CUSTOMER_EMAIL_UPDATE_REQUESTED]: {
        oldEmailAddress: string;
        newEmailAddress: string;
    };
    [HistoryEntryType.CUSTOMER_EMAIL_UPDATE_VERIFIED]: {
        oldEmailAddress: string;
        newEmailAddress: string;
    };
    [HistoryEntryType.CUSTOMER_NOTE]: {
        note: string;
    };
}

export interface OrderHistoryEntryData {
    [HistoryEntryType.ORDER_STATE_TRANSITION]: {
        from: OrderState;
        to: OrderState;
    };
    [HistoryEntryType.ORDER_PAYMENT_TRANSITION]: {
        paymentId: ID;
        from: PaymentState;
        to: PaymentState;
    };
    [HistoryEntryType.ORDER_FULFILLMENT_TRANSITION]: {
        fulfillmentId: ID;
        from: FulfillmentState;
        to: FulfillmentState;
    };
    [HistoryEntryType.ORDER_FULFILLMENT]: {
        fulfillmentId: ID;
    };
    [HistoryEntryType.ORDER_CANCELLATION]: {
        lines: OrderLineInput[];
        shippingCancelled: boolean;
        reason?: string;
    };
    [HistoryEntryType.ORDER_REFUND_TRANSITION]: {
        refundId: ID;
        from: RefundState;
        to: RefundState;
        reason?: string;
    };
    [HistoryEntryType.ORDER_NOTE]: {
        note: string;
    };
    [HistoryEntryType.ORDER_COUPON_APPLIED]: {
        couponCode: string;
        promotionId: ID;
    };
    [HistoryEntryType.ORDER_COUPON_REMOVED]: {
        couponCode: string;
    };
    [HistoryEntryType.ORDER_MODIFIED]: {
        modificationId: ID;
    };
    [HistoryEntryType.ORDER_CUSTOMER_UPDATED]: {
        previousCustomerId?: ID;
        previousCustomerName?: ID;
        newCustomerId: ID;
        newCustomerName: ID;
        note?: string;
    };
    [HistoryEntryType.ORDER_CURRENCY_UPDATED]: {
        previousCurrency?: CurrencyCode;
        newCurrency?: CurrencyCode;
    };
}

export interface CreateCustomerHistoryEntryArgs<T extends keyof CustomerHistoryEntryData> {
    customerId: ID;
    ctx: RequestContext;
    type: T;
    data: CustomerHistoryEntryData[T];
}

export interface CreateOrderHistoryEntryArgs<T extends keyof OrderHistoryEntryData> {
    orderId: ID;
    ctx: RequestContext;
    type: T;
    data: OrderHistoryEntryData[T];
}

export interface UpdateOrderHistoryEntryArgs<T extends keyof OrderHistoryEntryData> {
    entryId: ID;
    ctx: RequestContext;
    type: T;
    isPublic?: boolean;
    data?: OrderHistoryEntryData[T];
}

export interface UpdateCustomerHistoryEntryArgs<T extends keyof CustomerHistoryEntryData> {
    entryId: ID;
    ctx: RequestContext;
    type: T;
    data?: CustomerHistoryEntryData[T];
}

/**
 * @description
 * Contains methods relating to {@link HistoryEntry} entities. Histories are timelines of actions
 * related to a particular Customer or Order, recording significant events such as creation, state changes,
 * notes, etc.
 *
 * ## Custom History Entry Types
 *
 * Since Vendure v1.9.0, it is possible to define custom HistoryEntry types.
 *
 * Let's take an example where we have some Customers who are businesses. We want to verify their
 * tax ID in order to allow them wholesale rates. As part of this verification, we'd like to add
 * an entry into the Customer's history with data about the tax ID verification.
 *
 * First of all we'd extend the GraphQL `HistoryEntryType` enum for our new type as part of a plugin
 *
 * @example
 * ```ts
 * import { PluginCommonModule, VendurePlugin } from '\@vendure/core';
 * import { VerificationService } from './verification.service';
 *
 * \@VendurePlugin({
 *   imports: [PluginCommonModule],
 *   adminApiExtensions: {
 *     schema: gql`
 *       extend enum HistoryEntryType {
 *         CUSTOMER_TAX_ID_VERIFICATION
 *       }
 *     `,
 *   },
 *   providers: [VerificationService],
 * })
 * export class TaxIDVerificationPlugin {}
 * ```
 *
 * Next we need to create a TypeScript type definition file where we extend the `CustomerHistoryEntryData` interface. This is done
 * via TypeScript's [declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#merging-interfaces)
 * and [ambient modules](https://www.typescriptlang.org/docs/handbook/modules.html#ambient-modules) features.
 *
 * @example
 * ```ts
 * // types.ts
 * import { CustomerHistoryEntryData } from '\@vendure/core';
 *
 * export const CUSTOMER_TAX_ID_VERIFICATION = 'CUSTOMER_TAX_ID_VERIFICATION';
 *
 * declare module '@vendure/core' {
 *   interface CustomerHistoryEntryData {
 *     [CUSTOMER_TAX_ID_VERIFICATION]: {
 *       taxId: string;
 *       valid: boolean;
 *       name?: string;
 *       address?: string;
 *     };
 *   }
 * }
 * ```
 *
 * Note: it works exactly the same way if we wanted to add a custom type for Order history, except in that case we'd extend the
 * `OrderHistoryEntryData` interface instead.
 *
 * Now that we have our types set up, we can use the HistoryService to add a new HistoryEntry in a type-safe manner:
 *
 * @example
 * ```ts
 * // verification.service.ts
 * import { Injectable } from '\@nestjs/common';
 * import { RequestContext } from '\@vendure/core';
 * import { CUSTOMER_TAX_ID_VERIFICATION } from './types';
 *
 * \@Injectable()
 * export class VerificationService {
 *   constructor(private historyService: HistoryService) {}
 *
 *   async verifyTaxId(ctx: RequestContext, customerId: ID, taxId: string) {
 *     const result = await someTaxIdCheckingService(taxId);
 *
 *     await this.historyService.createHistoryEntryForCustomer({
 *       customerId,
 *       ctx,
 *       type: CUSTOMER_TAX_ID_VERIFICATION,
 *       data: {
 *         taxId,
 *         valid: result.isValid,
 *         name: result.companyName,
 *         address: result.registeredAddress,
 *       },
 *     });
 *   }
 * }
 * ```
 * :::info
 * It is also possible to define a UI component to display custom history entry types. See the
 * [Custom History Timeline Components guide](/guides/extending-the-admin-ui/custom-timeline-components/).
 * :::
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class HistoryService {
    constructor(
        private connection: TransactionalConnection,
        private administratorService: AdministratorService,
        private listQueryBuilder: ListQueryBuilder,
        private eventBus: EventBus,
    ) {}

    async getHistoryForOrder(
        ctx: RequestContext,
        orderId: ID,
        publicOnly: boolean,
        options?: HistoryEntryListOptions,
    ): Promise<PaginatedList<OrderHistoryEntry>> {
        return this.listQueryBuilder
            .build(HistoryEntry as any as Type<OrderHistoryEntry>, options, {
                where: {
                    order: { id: orderId } as any,
                    ...(publicOnly ? { isPublic: true } : {}),
                },
                relations: ['administrator'],
                ctx,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    async createHistoryEntryForOrder<T extends keyof OrderHistoryEntryData>(
        args: CreateOrderHistoryEntryArgs<T>,
        isPublic = true,
    ): Promise<OrderHistoryEntry> {
        const { ctx, data, orderId, type } = args;
        const administrator = await this.getAdministratorFromContext(ctx);
        const entry = new OrderHistoryEntry({
            type,
            isPublic,
            data: data as any,
            order: { id: orderId },
            administrator,
        });
        const history = await this.connection.getRepository(ctx, OrderHistoryEntry).save(entry);
        await this.eventBus.publish(new HistoryEntryEvent(ctx, history, 'created', 'order', { type, data }));
        return history;
    }

    async getHistoryForCustomer(
        ctx: RequestContext,
        customerId: ID,
        publicOnly: boolean,
        options?: HistoryEntryListOptions,
    ): Promise<PaginatedList<CustomerHistoryEntry>> {
        return this.listQueryBuilder
            .build(HistoryEntry as any as Type<CustomerHistoryEntry>, options, {
                where: {
                    customer: { id: customerId } as any,
                    ...(publicOnly ? { isPublic: true } : {}),
                },
                relations: ['administrator'],
                ctx,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    async createHistoryEntryForCustomer<T extends keyof CustomerHistoryEntryData>(
        args: CreateCustomerHistoryEntryArgs<T>,
        isPublic = false,
    ): Promise<CustomerHistoryEntry> {
        const { ctx, data, customerId, type } = args;
        const administrator = await this.getAdministratorFromContext(ctx);
        const entry = new CustomerHistoryEntry({
            createdAt: new Date(),
            type,
            isPublic,
            data: data as any,
            customer: { id: customerId },
            administrator,
        });
        const history = await this.connection.getRepository(ctx, CustomerHistoryEntry).save(entry);
        await this.eventBus.publish(
            new HistoryEntryEvent(ctx, history, 'created', 'customer', { type, data }),
        );
        return history;
    }

    async updateOrderHistoryEntry<T extends keyof OrderHistoryEntryData>(
        ctx: RequestContext,
        args: UpdateOrderHistoryEntryArgs<T>,
    ) {
        const entry = await this.connection.getEntityOrThrow(ctx, OrderHistoryEntry, args.entryId, {
            where: { type: args.type },
        });

        if (args.data) {
            entry.data = args.data;
        }
        if (typeof args.isPublic === 'boolean') {
            entry.isPublic = args.isPublic;
        }
        const administrator = await this.getAdministratorFromContext(ctx);
        if (administrator) {
            entry.administrator = administrator;
        }
        const newEntry = await this.connection.getRepository(ctx, OrderHistoryEntry).save(entry);
        await this.eventBus.publish(new HistoryEntryEvent(ctx, entry, 'updated', 'order', args));
        return newEntry;
    }

    async deleteOrderHistoryEntry(ctx: RequestContext, id: ID): Promise<void> {
        const entry = await this.connection.getEntityOrThrow(ctx, OrderHistoryEntry, id);
        const deletedEntry = new OrderHistoryEntry(entry);
        await this.connection.getRepository(ctx, OrderHistoryEntry).remove(entry);
        await this.eventBus.publish(new HistoryEntryEvent(ctx, deletedEntry, 'deleted', 'order', id));
    }

    async updateCustomerHistoryEntry<T extends keyof CustomerHistoryEntryData>(
        ctx: RequestContext,
        args: UpdateCustomerHistoryEntryArgs<T>,
    ) {
        const entry = await this.connection.getEntityOrThrow(ctx, CustomerHistoryEntry, args.entryId, {
            where: { type: args.type },
        });

        if (args.data) {
            entry.data = args.data;
        }
        const administrator = await this.getAdministratorFromContext(ctx);
        if (administrator) {
            entry.administrator = administrator;
        }
        const newEntry = await this.connection.getRepository(ctx, CustomerHistoryEntry).save(entry);
        await this.eventBus.publish(new HistoryEntryEvent(ctx, entry, 'updated', 'customer', args));
        return newEntry;
    }

    async deleteCustomerHistoryEntry(ctx: RequestContext, id: ID): Promise<void> {
        const entry = await this.connection.getEntityOrThrow(ctx, CustomerHistoryEntry, id);
        const deletedEntry = new CustomerHistoryEntry(entry);
        await this.connection.getRepository(ctx, CustomerHistoryEntry).remove(entry);
        await this.eventBus.publish(new HistoryEntryEvent(ctx, deletedEntry, 'deleted', 'customer', id));
    }

    private async getAdministratorFromContext(ctx: RequestContext): Promise<Administrator | undefined> {
        const administrator = ctx.activeUserId
            ? await this.administratorService.findOneByUserId(ctx, ctx.activeUserId)
            : null;
        return administrator ?? undefined;
    }
}
