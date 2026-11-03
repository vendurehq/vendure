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
exports.RoomTemplateAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const room_template_service_1 = require("./room-template.service");
let RoomTemplateAdminResolver = class RoomTemplateAdminResolver {
    constructor(roomTemplateService) {
        this.roomTemplateService = roomTemplateService;
    }
    async roomTemplates() {
        return this.roomTemplateService.findAll();
    }
    async roomTemplate(id) {
        return this.roomTemplateService.findOne(id);
    }
    async createRoomTemplate(input) {
        return this.roomTemplateService.create(input);
    }
    async updateRoomTemplate(id, input) {
        return this.roomTemplateService.update(id, input);
    }
    async deleteRoomTemplate(id) {
        await this.roomTemplateService.delete(id);
        return true;
    }
    async applyRoomTemplate(ctx, variantId, templateId) {
        return this.roomTemplateService.applyToVariant(ctx, variantId, templateId);
    }
};
exports.RoomTemplateAdminResolver = RoomTemplateAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RoomTemplateAdminResolver.prototype, "roomTemplates", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RoomTemplateAdminResolver.prototype, "roomTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RoomTemplateAdminResolver.prototype, "createRoomTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, graphql_1.Args)('id')),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RoomTemplateAdminResolver.prototype, "updateRoomTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RoomTemplateAdminResolver.prototype, "deleteRoomTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('variantId')),
    __param(2, (0, graphql_1.Args)('templateId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], RoomTemplateAdminResolver.prototype, "applyRoomTemplate", null);
exports.RoomTemplateAdminResolver = RoomTemplateAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [room_template_service_1.RoomTemplateService])
], RoomTemplateAdminResolver);
//# sourceMappingURL=room-template-admin.resolver.js.map