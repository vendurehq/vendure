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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShippingTemplateService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const shipping_template_entity_1 = require("./shipping-template.entity");
const fill_default_args_1 = require("../common/fill-default-args");
let ShippingTemplateService = class ShippingTemplateService {
    constructor(connection, shippingMethodService, configService) {
        this.connection = connection;
        this.shippingMethodService = shippingMethodService;
        this.configService = configService;
    }
    /**
     * 校验 checker/calculator 入参结构：{ code: string, arguments: { name, value }[] }
     * 兼容旧前端传参（ConfigArg 形态会被 GraphQL 拒绝，此处兜底给出可读错误）
     */
    assertTemplateOperation(label, value, required) {
        if (value === undefined) {
            if (required) {
                throw new core_1.UserInputError(`Shipping template "${label}" is required`);
            }
            return;
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            throw new core_1.UserInputError(`Shipping template "${label}" must be an object with "code" and "arguments"`);
        }
        const { code, arguments: args } = value;
        if (typeof code !== 'string' || code.trim() === '') {
            throw new core_1.UserInputError(`Shipping template "${label}" requires a non-empty "code"`);
        }
        if (!Array.isArray(args)) {
            throw new core_1.UserInputError(`Shipping template "${label}" "arguments" must be an array`);
        }
        for (const arg of args) {
            const item = arg;
            if (!item ||
                typeof item.name !== 'string' ||
                typeof item.value !== 'string') {
                throw new core_1.UserInputError(`Shipping template "${label}" "arguments" items must be { name: String!, value: String! }`);
            }
        }
    }
    /**
     * 查询模板列表（可见规则：全局模板 + 本租户模板）
     */
    async findAll(ctx, options) {
        var _a, _b, _c, _d, _e;
        const qb = this.connection.getRepository(ctx, shipping_template_entity_1.ShippingTemplate).createQueryBuilder('st');
        qb.where('(st.isGlobal = :isGlobal OR st.ownerChannelId = :channelId)', {
            isGlobal: true,
            channelId: ctx.channelId,
        });
        if ((_b = (_a = options === null || options === void 0 ? void 0 : options.filter) === null || _a === void 0 ? void 0 : _a.name) === null || _b === void 0 ? void 0 : _b['contains']) {
            qb.andWhere('st.name LIKE :name', { name: `%${options.filter.name['contains']}%` });
        }
        if ((_d = (_c = options === null || options === void 0 ? void 0 : options.filter) === null || _c === void 0 ? void 0 : _c.code) === null || _d === void 0 ? void 0 : _d['contains']) {
            qb.andWhere('st.code LIKE :code', { code: `%${options.filter.code['contains']}%` });
        }
        if (((_e = options === null || options === void 0 ? void 0 : options.filter) === null || _e === void 0 ? void 0 : _e.isGlobal) !== undefined) {
            qb.andWhere('st.isGlobal = :isGlobalFilter', { isGlobalFilter: options.filter.isGlobal });
        }
        const skip = (options === null || options === void 0 ? void 0 : options.skip) || 0;
        const take = (options === null || options === void 0 ? void 0 : options.take) || 10;
        qb.skip(skip).take(take);
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }
    /**
     * 查询单个模板
     */
    async findOne(ctx, id) {
        const result = await this.connection.getRepository(ctx, shipping_template_entity_1.ShippingTemplate).findOne({
            where: { id: id },
        });
        return result !== null && result !== void 0 ? result : undefined;
    }
    /**
     * 创建模板
     * - 超级管理员：isGlobal=true，ownerChannelId=null
     * - 租户管理员：isGlobal=false，ownerChannelId=当前channelId
     */
    async create(ctx, input) {
        var _a;
        this.assertTemplateOperation('checker', input === null || input === void 0 ? void 0 : input.checker, true);
        this.assertTemplateOperation('calculator', input === null || input === void 0 ? void 0 : input.calculator, true);
        const repo = this.connection.getRepository(ctx, shipping_template_entity_1.ShippingTemplate);
        const template = new shipping_template_entity_1.ShippingTemplate(input);
        template.channels = [ctx.channel];
        template.ownerChannelId = input.isGlobal ? null : ctx.channelId;
        template.isGlobal = (_a = input.isGlobal) !== null && _a !== void 0 ? _a : false;
        return repo.save(template);
    }
    /**
     * 更新模板（租户只能更新自己的模板，不能更新全局模板）
     */
    async update(ctx, input) {
        this.assertTemplateOperation('checker', input === null || input === void 0 ? void 0 : input.checker, false);
        this.assertTemplateOperation('calculator', input === null || input === void 0 ? void 0 : input.calculator, false);
        const repo = this.connection.getRepository(ctx, shipping_template_entity_1.ShippingTemplate);
        const template = await repo.findOne({ where: { id: input.id } });
        if (!template) {
            throw new core_1.EntityNotFoundError('ShippingTemplate', input.id);
        }
        // 租户不能修改全局模板
        if (template.isGlobal && !ctx.userHasPermissions([core_1.Permission.SuperAdmin])) {
            throw new core_1.UserInputError('Cannot modify global template');
        }
        const { id } = input, updateData = __rest(input, ["id"]);
        Object.assign(template, updateData);
        return repo.save(template);
    }
    /**
     * 删除模板（租户只能删除自己的模板，不能删除全局模板）
     */
    async delete(ctx, id) {
        const repo = this.connection.getRepository(ctx, shipping_template_entity_1.ShippingTemplate);
        const template = await repo.findOne({ where: { id: id } });
        if (!template) {
            throw new core_1.EntityNotFoundError('ShippingTemplate', id);
        }
        if (template.isGlobal && !ctx.userHasPermissions([core_1.Permission.SuperAdmin])) {
            throw new core_1.UserInputError('Cannot delete global template');
        }
        await repo.delete(id);
    }
    /**
     * 从模板创建配送方式（绑定到当前 Channel）
     * 租户可覆盖名称，否则使用模板名称
     */
    async createShippingMethodFromTemplate(ctx, templateId, nameOverride, codeOverride) {
        var _a;
        const template = await this.findOne(ctx, templateId);
        if (!template) {
            throw new core_1.EntityNotFoundError('ShippingTemplate', templateId);
        }
        const name = nameOverride || template.name;
        const code = codeOverride || template.code;
        // 使用 Vendure 内置 ShippingMethodService 创建
        const shippingMethod = await this.shippingMethodService.create(ctx, {
            code,
            translations: [
                {
                    languageCode: ctx.languageCode,
                    name,
                    description: template.description,
                },
            ],
            fulfillmentHandler: template.fulfillmentHandler,
            checker: ((_a = (0, fill_default_args_1.fillDefaultArgs)(template.checker, this.configService.shippingOptions.shippingEligibilityCheckers)) !== null && _a !== void 0 ? _a : undefined),
            calculator: template.calculator,
        });
        return shippingMethod;
    }
    /**
     * 更新配送方式实例的固定运费（shippingPrice，分）。
     * 租户级计费：引用自提/同城模板后，租户在自己配送方式实例上配置固定运费。
     * 仅更新 calculator 的 shippingPrice 参数，其余参数与 checker 保持不变。
     */
    async updateShippingMethodShippingPrice(ctx, id, shippingPrice) {
        var _a, _b;
        const fee = Math.max(0, Math.round(Number(shippingPrice) || 0));
        const method = await this.shippingMethodService.findOne(ctx, id);
        if (!method)
            throw new core_1.EntityNotFoundError('ShippingMethod', id);
        const calculator = (_a = method.calculator) !== null && _a !== void 0 ? _a : {};
        const args = ((_b = calculator.args) !== null && _b !== void 0 ? _b : []).map((a) => (Object.assign({}, a)));
        const existing = args.find((a) => a.name === 'shippingPrice');
        if (existing) {
            existing.value = String(fee);
        }
        else {
            args.push({ name: 'shippingPrice', value: String(fee) });
        }
        const updated = await this.shippingMethodService.update(ctx, {
            id,
            calculator: { code: calculator.code, arguments: args },
        });
        return updated;
    }
};
exports.ShippingTemplateService = ShippingTemplateService;
exports.ShippingTemplateService = ShippingTemplateService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ShippingMethodService,
        core_1.ConfigService])
], ShippingTemplateService);
//# sourceMappingURL=shipping-template.service.js.map