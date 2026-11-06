"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MessagePlugin_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagePlugin = void 0;
const core_1 = require("@vendure/core");
const channel_custom_fields_1 = require("./channel-custom-fields");
const constants_1 = require("./constants");
const customer_custom_fields_1 = require("./customer-custom-fields");
const message_delivery_entity_1 = require("./entities/message-delivery.entity");
const message_entity_1 = require("./entities/message.entity");
const message_job_1 = require("./message-job");
const message_admin_resolver_1 = require("./message-admin.resolver");
const message_push_service_1 = require("./message-push.service");
const message_service_1 = require("./message.service");
/** Idempotently merge custom fields, deduplicating by field name (preBootstrapConfig may run plugin configurations multiple times). */
function mergeCustomFields(existingFields, additions) {
    const names = new Set((existingFields !== null && existingFields !== void 0 ? existingFields : []).map(f => f.name));
    return [...(existingFields !== null && existingFields !== void 0 ? existingFields : []), ...(additions !== null && additions !== void 0 ? additions : []).filter(f => !names.has(f.name))];
}
const message_shop_resolver_1 = require("./message-shop.resolver");
const { gql } = require('graphql-tag');
let MessagePlugin = MessagePlugin_1 = class MessagePlugin {
    constructor(messageJob) {
        this.messageJob = messageJob;
    }
    static init(options) {
        MessagePlugin_1.options = options !== null && options !== void 0 ? options : {};
        return MessagePlugin_1;
    }
    async onApplicationBootstrap() {
        await this.messageJob.init();
        core_1.Logger.info('MessagePlugin initialized', constants_1.loggerCtx);
    }
};
exports.MessagePlugin = MessagePlugin;
MessagePlugin.options = {};
exports.MessagePlugin = MessagePlugin = MessagePlugin_1 = __decorate([
    (0, core_1.VendurePlugin)({
        imports: [core_1.PluginCommonModule],
        entities: [message_entity_1.Message, message_delivery_entity_1.MessageDelivery],
        providers: [
            { provide: constants_1.MESSAGE_PLUGIN_OPTIONS, useFactory: () => MessagePlugin.options },
            message_service_1.MessageService,
            message_push_service_1.MessagePushService,
            message_job_1.MessageJob,
        ],
        adminApiExtensions: {
            schema: () => gql `
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
            resolvers: [message_admin_resolver_1.MessageAdminResolver],
        },
        shopApiExtensions: {
            schema: () => gql `
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
            resolvers: [message_shop_resolver_1.MessageShopResolver],
        },
        configuration: (config) => {
            config.customFields.Channel = mergeCustomFields(config.customFields.Channel, channel_custom_fields_1.messageChannelCustomFields.Channel);
            config.customFields.Customer = mergeCustomFields(config.customFields.Customer, customer_custom_fields_1.messageCustomerCustomFields.Customer);
            return config;
        },
        compatibility: '^3.0.0',
    }),
    __metadata("design:paramtypes", [message_job_1.MessageJob])
], MessagePlugin);
