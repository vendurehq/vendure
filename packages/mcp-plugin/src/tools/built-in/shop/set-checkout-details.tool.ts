import { Injectable } from '@nestjs/common';
import { CreateAddressInput, CreateCustomerInput } from '@vendure/common/lib/generated-shop-types';
import {
    ConfigService,
    EntityNotFoundError,
    GraphQLErrorResult,
    isGraphQlErrorResult,
    Order,
    OrderModificationError,
    OrderService,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { cartIsEditable, McpActiveOrderService } from '../active-order.service';
import { emailAddressSchema } from '../email-schema';
import { McpToolSerializerService } from '../serializer.service';

import { addressInputSchema } from './address-schema';

const setCheckoutDetailsInput = z
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
        customer: z
            .strictObject({
                emailAddress: emailAddressSchema.describe('Buyer email address.'),
                firstName: z.string().describe('Buyer first name.'),
                lastName: z.string().describe('Buyer last name.'),
            })
            .describe(
                'Who is buying, for a guest checkout. Not needed when the caller is a signed-in customer.',
            )
            .optional(),
    })
    .refine(
        input =>
            input.shippingAddress || input.billingAddress || input.billingSameAsShipping || input.customer,
        {
            message: 'Pass shippingAddress, billingAddress, billingSameAsShipping: true, or customer.',
        },
    )
    .refine(input => !(input.billingAddress && input.billingSameAsShipping), {
        message: 'billingAddress and billingSameAsShipping cannot both be given.',
    });

type SetCheckoutDetailsInput = z.infer<typeof setCheckoutDetailsInput>;

const shippingMethodReplacedMessage =
    'The new shipping address made the chosen shipping method ineligible, so the store replaced it ' +
    'with the cheapest eligible one (see order.shippingLines). Tell the shopper, or call ' +
    'get_eligible_shipping_methods and set_shipping_method to pick another.';
const shippingMethodRemovedMessage =
    'The new shipping address made the chosen shipping method ineligible and no other method is ' +
    'eligible, so the cart has no shipping method. Call get_eligible_shipping_methods and ' +
    'set_shipping_method again before place_order.';

@McpTool({
    name: 'set_checkout_details',
    toolset: 'shop',
    description:
        "Set the cart's shipping address, billing address, or both, and for a guest checkout the " +
        "buyer's email and name, in one call. A guest checkout needs the buyer named here, through " +
        'customer, before place_order will take a payment. Changing the shipping address can make ' +
        'the chosen shipping method ineligible; the response then carries shippingMethodChanged: ' +
        'true and a message saying whether the store swapped the method or dropped it.',
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
        'check out as a guest',
        'buy without an account',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    usesActiveOrder: true,
    inputSchema: setCheckoutDetailsInput,
})
@Injectable()
export class SetCheckoutDetailsTool implements McpToolHandler<SetCheckoutDetailsInput> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private connection: TransactionalConnection,
        private serializer: McpToolSerializerService,
        private configService: ConfigService,
    ) {}

    async execute(ctx: RequestContext, input: SetCheckoutDetailsInput) {
        // Core's DefaultGuestCheckoutStrategy refuses a signed-in caller too, with
        // AlreadyLoggedInError. This guard is only here for the clearer sentence, and to stop
        // before the cart is touched.
        if (input.customer && ctx.activeUserId) {
            throw new UserInputError('This call is signed in as a customer; omit customer.');
        }
        const cart = await this.activeOrder.findOrThrow(ctx);
        if (!cartIsEditable(cart)) {
            return this.serializer.orderOrError(new OrderModificationError());
        }
        return this.connection.withTransaction(cart.ctx, async txCtx => {
            // The customer relation is loaded so that the answer can show who the cart belongs to.
            const before = await this.orderService.findOne(txCtx, cart.id, ['shippingLines', 'customer']);
            if (!before) {
                // The cart was there a moment ago, so only a concurrent deletion gets here.
                throw new EntityNotFoundError('Order', cart.id);
            }
            const methodsBefore = shippingMethodIds(before);

            let order: Order | undefined = before;
            // A rejected guest — an email that already has an account, say — comes back as a
            // returned error result, which leaves the transaction to commit whatever was written
            // before it, while a thrown error rolls the whole call back. So the buyer is named
            // first: a refusal there then leaves the cart with no addresses written either.
            if (input.customer) {
                const withCustomer = await this.setGuestCustomer(txCtx, before, input.customer);
                if (isGraphQlErrorResult(withCustomer)) {
                    return this.serializer.orderOrError(withCustomer);
                }
                order = withCustomer;
            }
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

    /**
     * Names a guest buyer on the cart, the same way the Shop API's `setCustomerForOrder` mutation
     * does. The store's guest checkout strategy turns the details into a Customer, and refuses
     * when guest checkout is switched off or when the email address already has an account; the
     * cart is then attached to that Customer. The other half of what the Shop API does for a guest,
     * saving the checkout address to the new Customer's address book, happens in `place_order`.
     */
    private async setGuestCustomer(
        ctx: RequestContext,
        order: Order,
        input: CreateCustomerInput,
    ): Promise<Order | GraphQLErrorResult> {
        const { guestCheckoutStrategy } = this.configService.orderOptions;
        const customer = await guestCheckoutStrategy.setCustomerForOrder(ctx, order, input);
        if (isGraphQlErrorResult(customer)) {
            return customer;
        }
        return this.orderService.addCustomerToOrder(ctx, order.id, customer);
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
