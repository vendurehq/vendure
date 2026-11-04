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
exports.TagResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const generated_types_1 = require("@vendure/common/lib/generated-types");
const errors_1 = require("../../../common/error/errors");
const tag_service_1 = require("../../../service/services/tag.service");
const request_context_1 = require("../../common/request-context");
const allow_decorator_1 = require("../../decorators/allow.decorator");
const request_context_decorator_1 = require("../../decorators/request-context.decorator");
const transaction_decorator_1 = require("../../decorators/transaction.decorator");
let TagResolver = class TagResolver {
    constructor(tagService) {
        this.tagService = tagService;
    }
    async tags(ctx, args) {
        return this.tagService.findAll(ctx, args.options);
    }
    async tag(ctx, args) {
        const tag = await this.tagService.findOne(ctx, args.id);
        if (!tag) {
            throw new errors_1.EntityNotFoundError('Tag', args.id);
        }
        return tag;
    }
    async createTag(ctx, args) {
        return this.tagService.create(ctx, args.input);
    }
    async updateTag(ctx, args) {
        return this.tagService.update(ctx, args.input);
    }
    async deleteTag(ctx, args) {
        return this.tagService.delete(ctx, args.id);
    }
};
exports.TagResolver = TagResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.ReadSettings, generated_types_1.Permission.ReadTag, generated_types_1.Permission.ReadAsset),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TagResolver.prototype, "tags", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.ReadSettings, generated_types_1.Permission.ReadTag, generated_types_1.Permission.ReadAsset),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TagResolver.prototype, "tag", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.CreateSettings, generated_types_1.Permission.CreateTag),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TagResolver.prototype, "createTag", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.UpdateSettings, generated_types_1.Permission.UpdateTag),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TagResolver.prototype, "updateTag", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_types_1.Permission.DeleteSettings, generated_types_1.Permission.DeleteTag),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TagResolver.prototype, "deleteTag", null);
exports.TagResolver = TagResolver = __decorate([
    (0, graphql_1.Resolver)('Tag'),
    __metadata("design:paramtypes", [tag_service_1.TagService])
], TagResolver);
//# sourceMappingURL=tag.resolver.js.map