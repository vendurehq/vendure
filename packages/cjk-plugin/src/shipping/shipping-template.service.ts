import { Injectable } from '@nestjs/common';
import {
    Channel,
    ConfigService,
    EntityNotFoundError,
    ID,
    PaginatedList,
    ListQueryOptions,
    Permission,
    RequestContext,
    TransactionalConnection,
    ShippingMethodService,
    UserInputError,
} from '@vendure/core';
import { ShippingTemplate } from './shipping-template.entity';
import { fillDefaultArgs } from '../common/fill-default-args';

@Injectable()
export class ShippingTemplateService {
    constructor(
        private connection: TransactionalConnection,
        private shippingMethodService: ShippingMethodService,
        private configService: ConfigService,
    ) {}

    /**
     * 校验 checker/calculator 入参结构：{ code: string, arguments: { name, value }[] }
     * 兼容旧前端传参（ConfigArg 形态会被 GraphQL 拒绝，此处兜底给出可读错误）
     */
    private assertTemplateOperation(label: string, value: unknown, required: boolean): void {
        if (value === undefined) {
            if (required) {
                throw new UserInputError(`Shipping template "${label}" is required`);
            }
            return;
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            throw new UserInputError(
                `Shipping template "${label}" must be an object with "code" and "arguments"`,
            );
        }
        const { code, arguments: args } = value as { code?: unknown; arguments?: unknown };
        if (typeof code !== 'string' || code.trim() === '') {
            throw new UserInputError(`Shipping template "${label}" requires a non-empty "code"`);
        }
        if (!Array.isArray(args)) {
            throw new UserInputError(`Shipping template "${label}" "arguments" must be an array`);
        }
        for (const arg of args) {
            const item = arg as { name?: unknown; value?: unknown } | null;
            if (
                !item ||
                typeof item.name !== 'string' ||
                typeof item.value !== 'string'
            ) {
                throw new UserInputError(
                    `Shipping template "${label}" "arguments" items must be { name: String!, value: String! }`,
                );
            }
        }
    }

    /**
     * 查询模板列表（可见规则：全局模板 + 本租户模板）
     */
    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<ShippingTemplate>,
    ): Promise<PaginatedList<ShippingTemplate>> {
        const qb = this.connection.getRepository(ctx, ShippingTemplate).createQueryBuilder('st');
        qb.where('(st.isGlobal = :isGlobal OR st.ownerChannelId = :channelId)', {
            isGlobal: true,
            channelId: ctx.channelId,
        });

        if (options?.filter?.name?.['contains']) {
            qb.andWhere('st.name LIKE :name', { name: `%${options.filter.name['contains']}%` });
        }
        if (options?.filter?.code?.['contains']) {
            qb.andWhere('st.code LIKE :code', { code: `%${options.filter.code['contains']}%` });
        }
        if (options?.filter?.isGlobal !== undefined) {
            qb.andWhere('st.isGlobal = :isGlobalFilter', { isGlobalFilter: options.filter.isGlobal });
        }

        const skip = options?.skip || 0;
        const take = options?.take || 10;
        qb.skip(skip).take(take);

        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    /**
     * 查询单个模板
     */
    async findOne(ctx: RequestContext, id: ID): Promise<ShippingTemplate | undefined> {
        const result = await this.connection.getRepository(ctx, ShippingTemplate).findOne({
            where: { id: id as any },
        });
        return result ?? undefined;
    }

    /**
     * 创建模板
     * - 超级管理员：isGlobal=true，ownerChannelId=null
     * - 租户管理员：isGlobal=false，ownerChannelId=当前channelId
     */
    async create(ctx: RequestContext, input: any): Promise<ShippingTemplate> {
        this.assertTemplateOperation('checker', input?.checker, true);
        this.assertTemplateOperation('calculator', input?.calculator, true);
        const repo = this.connection.getRepository(ctx, ShippingTemplate);
        const template = new ShippingTemplate(input);
        template.channels = [ctx.channel];
        template.ownerChannelId = input.isGlobal ? null : ctx.channelId;
        template.isGlobal = input.isGlobal ?? false;
        return repo.save(template);
    }

    /**
     * 更新模板（租户只能更新自己的模板，不能更新全局模板）
     */
    async update(ctx: RequestContext, input: any): Promise<ShippingTemplate> {
        this.assertTemplateOperation('checker', input?.checker, false);
        this.assertTemplateOperation('calculator', input?.calculator, false);
        const repo = this.connection.getRepository(ctx, ShippingTemplate);
        const template = await repo.findOne({ where: { id: input.id } });
        if (!template) {
            throw new EntityNotFoundError('ShippingTemplate', input.id);
        }
        // 租户不能修改全局模板
        if (template.isGlobal && !ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new UserInputError('Cannot modify global template');
        }
        const { id, ...updateData } = input;
        Object.assign(template, updateData);
        return repo.save(template);
    }

    /**
     * 删除模板（租户只能删除自己的模板，不能删除全局模板）
     */
    async delete(ctx: RequestContext, id: ID): Promise<void> {
        const repo = this.connection.getRepository(ctx, ShippingTemplate);
        const template = await repo.findOne({ where: { id: id as any } });
        if (!template) {
            throw new EntityNotFoundError('ShippingTemplate', id);
        }
        if (template.isGlobal && !ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new UserInputError('Cannot delete global template');
        }
        await repo.delete(id);
    }

    /**
     * 从模板创建配送方式（绑定到当前 Channel）
     * 租户可覆盖名称，否则使用模板名称
     */
    async createShippingMethodFromTemplate(
        ctx: RequestContext,
        templateId: ID,
        nameOverride?: string,
        codeOverride?: string,
    ): Promise<any> {
        const template = await this.findOne(ctx, templateId);
        if (!template) {
            throw new EntityNotFoundError('ShippingTemplate', templateId);
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
            checker:
                (fillDefaultArgs(
                    template.checker,
                    this.configService.shippingOptions.shippingEligibilityCheckers as any,
                ) ?? undefined) as any,
            calculator: template.calculator,
        });

        return shippingMethod;
    }

    /**
     * 更新配送方式实例的固定运费（shippingPrice，分）。
     * 租户级计费：引用自提/同城模板后，租户在自己配送方式实例上配置固定运费。
     * 仅更新 calculator 的 shippingPrice 参数，其余参数与 checker 保持不变。
     */
    async updateShippingMethodShippingPrice(
        ctx: RequestContext,
        id: ID,
        shippingPrice: number,
    ): Promise<any> {
        const fee = Math.max(0, Math.round(Number(shippingPrice) || 0));
        const method = await this.shippingMethodService.findOne(ctx, id);
        if (!method) throw new EntityNotFoundError('ShippingMethod', id);
        const calculator = (method as any).calculator ?? {};
        const args = (calculator.args ?? []).map((a: { name: string; value: string }) => ({ ...a }));
        const existing = args.find((a: { name: string }) => a.name === 'shippingPrice');
        if (existing) {
            existing.value = String(fee);
        } else {
            args.push({ name: 'shippingPrice', value: String(fee) });
        }
        const updated = await this.shippingMethodService.update(ctx, {
            id,
            calculator: { code: calculator.code, arguments: args },
        } as any);
        return updated;
    }
}
