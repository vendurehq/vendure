import { OnApplicationBootstrap, Type } from '@nestjs/common';
import { Logger, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { messageChannelCustomFields } from './channel-custom-fields';
import { loggerCtx, MESSAGE_PLUGIN_OPTIONS } from './constants';
import { messageCustomerCustomFields } from './customer-custom-fields';
import { MessageDelivery } from './entities/message-delivery.entity';
import { Message } from './entities/message.entity';
import { MessageJob } from './message-job';
import { MessageAdminResolver } from './message-admin.resolver';
import { MessagePushService } from './message-push.service';
import { MessageService } from './message.service';

/** Idempotently merge custom fields, deduplicating by field name (preBootstrapConfig may run plugin configurations multiple times). */
function mergeCustomFields<T extends { name: string }>(
    existingFields: T[] | undefined,
    additions: T[] | undefined,
): T[] {
    const names = new Set((existingFields ?? []).map(f => f.name));
    return [...(existingFields ?? []), ...(additions ?? []).filter(f => !names.has(f.name))];
}
import { MessageShopResolver } from './message-shop.resolver';
import { MessagePluginOptions } from './types';

const { gql } = require('graphql-tag');

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [Message, MessageDelivery],
    providers: [
        { provide: MESSAGE_PLUGIN_OPTIONS, useFactory: () => MessagePlugin.options },
        MessageService,
        MessagePushService,
        MessageJob,
    ],
    adminApiExtensions: {
        schema: () => gql`
            type Message implements Node {
                id: ID!
                title: String!
                body: String!
                deliveryChannel: String!
                audienceType: String!
                audienceLevel: Int
                status: String!
                totalTarget: Int!
                totalSent: Int!
                totalFailed: Int!
                createdAt: DateTime!
                sentAt: DateTime
            }

            type MessageList implements PaginatedList {
                items: [Message!]!
                totalItems: Int!
            }

            input CreateMessageInput {
                title: String!
                body: String!
                deliveryChannel: String
                audienceType: String
                audienceLevel: Int
            }

            input UpdateMessageInput {
                title: String
                body: String
                deliveryChannel: String
                audienceType: String
                audienceLevel: Int
            }

            type MessageDeliveryStats {
                totalTarget: Int!
                totalSent: Int!
                totalFailed: Int!
                totalRead: Int!
            }

            extend type Query {
                messages(options: JSON): MessageList!
                message(id: ID!): Message
                messageDeliveryStats(id: ID!): MessageDeliveryStats!
            }

            extend type Mutation {
                createMessage(input: CreateMessageInput!): Message!
                updateMessage(id: ID!, input: UpdateMessageInput!): Message!
                deleteMessage(id: ID!): Boolean!
                sendMessage(id: ID!): Message!
            }
        `,
        resolvers: [MessageAdminResolver],
    },
    shopApiExtensions: {
        schema: () => gql`
            type MyMessage implements Node {
                id: ID!
                messageId: ID!
                title: String!
                body: String!
                readAt: DateTime
                createdAt: DateTime!
            }

            type MyMessageList implements PaginatedList {
                items: [MyMessage!]!
                totalItems: Int!
            }

            # 以生产契约为准：myMessages 接受 skip/take 输入对象（非 JSON 标量）。
            # 迁移到本地仓库时生产已在用该契约，按仓库旧 JSON 构建会打断外卖消息中心。
            input MyMessageListOptions {
                skip: Int
                take: Int
            }

            extend type Query {
                myMessages(options: MyMessageListOptions): MyMessageList!
                myUnreadMessageCount: Int!
            }

            extend type Mutation {
                markMessageRead(id: ID!): Boolean!
            }
        `,
        resolvers: [MessageShopResolver],
    },
    configuration: (config) => {
        config.customFields.Channel = mergeCustomFields(config.customFields.Channel, messageChannelCustomFields.Channel);
        config.customFields.Customer = mergeCustomFields(config.customFields.Customer, messageCustomerCustomFields.Customer);
        return config;
    },
    compatibility: '^3.0.0',
})
export class MessagePlugin implements OnApplicationBootstrap {
    private static options: MessagePluginOptions = {};

    constructor(private messageJob: MessageJob) {}

    static init(options?: MessagePluginOptions): Type<MessagePlugin> {
        MessagePlugin.options = options ?? {};
        return MessagePlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        await this.messageJob.init();
        Logger.info('MessagePlugin initialized', loggerCtx);
    }
}
