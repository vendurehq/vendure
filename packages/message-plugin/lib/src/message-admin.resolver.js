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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const delivery_plugin_1 = require("@vendure/delivery-plugin");
const message_job_1 = require("./message-job");
const message_service_1 = require("./message.service");
let MessageAdminResolver = class MessageAdminResolver {
    constructor(messageService, messageJob) {
        this.messageService = messageService;
        this.messageJob = messageJob;
    }
    async messages(ctx, options = { take: 20 }) {
        // GraphQL 显式/nullable 缺省时 Nest 会传 null，参数默认值不生效，需二次兜底
        return this.messageService.findAll(ctx, options !== null && options !== void 0 ? options : { take: 20 });
    }
    async message(ctx, id) {
        return this.messageService.findOne(ctx, id);
    }
    async messageDeliveryStats(ctx, id) {
        return this.messageService.getDeliveryStats(ctx, id);
    }
    async createMessage(ctx, input) {
        return this.messageService.create(ctx, input);
    }
    async updateMessage(ctx, id, input) {
        return this.messageService.update(ctx, id, input);
    }
    async deleteMessage(ctx, id) {
        return this.messageService.delete(ctx, id);
    }
    async sendMessage(ctx, id) {
        const msg = await this.messageService.sendMessage(ctx, id);
        await this.messageJob.addSendJob(msg.id, ctx.channelId);
        return msg;
    }
};
exports.MessageAdminResolver = MessageAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(delivery_plugin_1.DeliveryPermissions.ManageMessage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MessageAdminResolver.prototype, "messages", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(delivery_plugin_1.DeliveryPermissions.ManageMessage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MessageAdminResolver.prototype, "message", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(delivery_plugin_1.DeliveryPermissions.ManageMessage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MessageAdminResolver.prototype, "messageDeliveryStats", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(delivery_plugin_1.DeliveryPermissions.ManageMessage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MessageAdminResolver.prototype, "createMessage", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(delivery_plugin_1.DeliveryPermissions.ManageMessage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], MessageAdminResolver.prototype, "updateMessage", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(delivery_plugin_1.DeliveryPermissions.ManageMessage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MessageAdminResolver.prototype, "deleteMessage", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(delivery_plugin_1.DeliveryPermissions.ManageMessage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MessageAdminResolver.prototype, "sendMessage", null);
exports.MessageAdminResolver = MessageAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [message_service_1.MessageService,
        message_job_1.MessageJob])
], MessageAdminResolver);
