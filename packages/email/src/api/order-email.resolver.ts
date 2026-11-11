import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, ID, RequestContext } from '@vendure/core';
import { gql } from 'graphql-tag';

import { OrderEmailService } from './order-email.service';

export const adminApiExtensions = gql`
    type OrderEmailTarget {
        id: String!
        label: String!
        eligible: Boolean!
        reason: String
    }

    type OrderEmail {
        type: String!
        label: String!
        targets: [OrderEmailTarget!]!
    }

    type OrderEmailList {
        recipient: String
        emails: [OrderEmail!]!
    }

    type OrderEmailPreview {
        recipient: String!
        from: String!
        subject: String!
        html: String!
        templateOrigin: String!
    }

    type SendOrderEmailResult {
        success: Boolean!
        recipient: String!
    }

    input OrderEmailInput {
        orderId: ID!
        type: String!
        targetId: String!
        languageCode: LanguageCode
    }

    input SendOrderEmailInput {
        orderId: ID!
        type: String!
        targetId: String!
        languageCode: LanguageCode
        "Send to this address instead of the order's customer"
        recipient: String
    }

    extend type Query {
        "The emails that can be sent for an order, and whether its current state allows each one"
        orderEmails(orderId: ID!): OrderEmailList!
        previewOrderEmail(input: OrderEmailInput!): OrderEmailPreview!
    }

    extend type Mutation {
        "Sends an order email by hand. Fails if the order's current state does not allow it"
        sendOrderEmail(input: SendOrderEmailInput!): SendOrderEmailResult!
    }
`;

@Resolver()
export class OrderEmailResolver {
    constructor(private orderEmailService: OrderEmailService) {}

    @Query()
    @Allow(Permission.ReadOrder)
    orderEmails(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return this.orderEmailService.listForOrder(ctx, args.orderId);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    previewOrderEmail(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { orderId: ID; type: string; targetId: string; languageCode?: LanguageCode } },
    ) {
        return this.orderEmailService.preview(ctx, args.input);
    }

    @Mutation()
    @Allow(Permission.UpdateOrder)
    sendOrderEmail(
        @Ctx() ctx: RequestContext,
        @Args()
        args: {
            input: { orderId: ID; type: string; targetId: string; languageCode?: LanguageCode; recipient?: string };
        },
    ) {
        return this.orderEmailService.send(ctx, args.input);
    }
}
