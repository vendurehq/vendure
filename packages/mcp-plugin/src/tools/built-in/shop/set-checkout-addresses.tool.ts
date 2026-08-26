import { Injectable } from '@nestjs/common';
import { CreateAddressInput } from '@vendure/common/lib/generated-shop-types';
import {
    Order,
    OrderService,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';

import { addressInputSchema } from './address-schema';

const setCheckoutAddressesInput = z
    .strictObject({
        shippingAddress: addressInputSchema.describe('Where the order is delivered.').optional(),
        billingAddress: addressInputSchema.describe('Where the invoice goes.').optional(),
        billingSameAsShipping: z
            .boolean()
            .describe(
                'Use the shipping address as the billing address too. Copies shippingAddress from this ' +
                    'call, or the shipping address already on the cart. Cannot be combined with billingAddress.',
            )
            .optional(),
    })
    .refine(input => input.shippingAddress || input.billingAddress || input.billingSameAsShipping, {
        message: 'Pass shippingAddress, billingAddress, or billingSameAsShipping: true.',
    })
    .refine(input => !(input.billingAddress && input.billingSameAsShipping), {
        message: 'billingAddress and billingSameAsShipping cannot both be given.',
    });

type SetCheckoutAddressesInput = z.infer<typeof setCheckoutAddressesInput>;

const shippingMethodReplacedMessage =
    'The new shipping address made the chosen shipping method ineligible, so the store replaced it ' +
    'with the cheapest eligible one (see order.shippingLines). Tell the shopper, or call ' +
    'get_eligible_shipping_methods and set_shipping_method to pick another.';
const shippingMethodRemovedMessage =
    'The new shipping address made the chosen shipping method ineligible and no other method is ' +
    'eligible, so the cart has no shipping method. Call get_eligible_shipping_methods and ' +
    'set_shipping_method again before place_order.';

@McpTool({
    name: 'set_checkout_addresses',
    toolset: 'shop',
    description:
        'Set the active cart shipping address, billing address, or both in one call. Changing the ' +
        'shipping address can make the chosen shipping method ineligible; the response then carries ' +
        'shippingMethodChanged: true and a message saying whether the store swapped the method or ' +
        'dropped it.',
    keywords: [
        'enter my delivery address',
        'where to ship my order',
        'add my shipping details',
        'set where I want it delivered',
        'send it to this address',
        'enter my billing address',
        'where to send the invoice',
        'set the address on my card',
        'billing details for checkout',
        'same address for billing and shipping',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    usesActiveOrder: true,
    inputSchema: setCheckoutAddressesInput,
})
@Injectable()
export class SetCheckoutAddressesTool implements McpToolHandler<SetCheckoutAddressesInput> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private connection: TransactionalConnection,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SetCheckoutAddressesInput) {
        const cart = await this.activeOrder.findOrThrow(ctx);
        return this.connection.withTransaction(cart.ctx, async txCtx => {
            const before = await this.orderService.findOne(txCtx, cart.id, ['shippingLines']);
            const methodsBefore = shippingMethodIds(before);

            let order: Order | undefined = before;
            if (input.shippingAddress) {
                order = await this.orderService.setShippingAddress(txCtx, cart.id, input.shippingAddress);
            }
            const billingAddress = input.billingSameAsShipping
                ? asBillingAddress(input.shippingAddress ?? order?.shippingAddress)
                : input.billingAddress;
            if (billingAddress) {
                order = await this.orderService.setBillingAddress(txCtx, cart.id, billingAddress);
            }

            const methodsAfter = shippingMethodIds(order);
            const changed = methodsBefore.length > 0 && !sameIds(methodsBefore, methodsAfter);
            const message =
                methodsAfter.length === 0 ? shippingMethodRemovedMessage : shippingMethodReplacedMessage;
            return {
                order: this.serializer.order(order),
                ...(changed ? { shippingMethodChanged: true, message } : {}),
            };
        });
    }
}

function shippingMethodIds(order: Order | undefined): string[] {
    return (order?.shippingLines ?? []).map(line => String(line.shippingMethodId)).sort();
}

function sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

function asBillingAddress(
    source: Partial<CreateAddressInput> | Order['shippingAddress'] | undefined,
): CreateAddressInput {
    if (!source?.streetLine1 || !source.countryCode) {
        throw new UserInputError(
            'billingSameAsShipping needs a shipping address: pass shippingAddress in the same call, or ' +
                'set one first.',
        );
    }
    return {
        fullName: source.fullName ?? undefined,
        company: source.company ?? undefined,
        streetLine1: source.streetLine1,
        streetLine2: source.streetLine2 ?? undefined,
        city: source.city ?? undefined,
        province: source.province ?? undefined,
        postalCode: source.postalCode ?? undefined,
        countryCode: source.countryCode,
        phoneNumber: source.phoneNumber ?? undefined,
        customFields: source.customFields ?? undefined,
    };
}
