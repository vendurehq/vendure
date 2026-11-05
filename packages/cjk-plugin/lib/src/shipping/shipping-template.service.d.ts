import { ConfigService, ID, PaginatedList, ListQueryOptions, RequestContext, TransactionalConnection, ShippingMethodService } from '@vendure/core';
import { ShippingTemplate } from './shipping-template.entity';
export declare class ShippingTemplateService {
    private connection;
    private shippingMethodService;
    private configService;
    constructor(connection: TransactionalConnection, shippingMethodService: ShippingMethodService, configService: ConfigService);
    /**
     * 校验 checker/calculator 入参结构：{ code: string, arguments: { name, value }[] }
     * 兼容旧前端传参（ConfigArg 形态会被 GraphQL 拒绝，此处兜底给出可读错误）
     */
    private assertTemplateOperation;
    /**
     * 查询模板列表（可见规则：全局模板 + 本租户模板）
     */
    findAll(ctx: RequestContext, options?: ListQueryOptions<ShippingTemplate>): Promise<PaginatedList<ShippingTemplate>>;
    /**
     * 查询单个模板
     */
    findOne(ctx: RequestContext, id: ID): Promise<ShippingTemplate | undefined>;
    /**
     * 创建模板
     * - 超级管理员：isGlobal=true，ownerChannelId=null
     * - 租户管理员：isGlobal=false，ownerChannelId=当前channelId
     */
    create(ctx: RequestContext, input: any): Promise<ShippingTemplate>;
    /**
     * 更新模板（租户只能更新自己的模板，不能更新全局模板）
     */
    update(ctx: RequestContext, input: any): Promise<ShippingTemplate>;
    /**
     * 删除模板（租户只能删除自己的模板，不能删除全局模板）
     */
    delete(ctx: RequestContext, id: ID): Promise<void>;
    /**
     * 从模板创建配送方式（绑定到当前 Channel）
     * 租户可覆盖名称，否则使用模板名称
     */
    createShippingMethodFromTemplate(ctx: RequestContext, templateId: ID, nameOverride?: string, codeOverride?: string): Promise<any>;
    /**
     * 更新配送方式实例的固定运费（shippingPrice，分）。
     * 租户级计费：引用自提/同城模板后，租户在自己配送方式实例上配置固定运费。
     * 仅更新 calculator 的 shippingPrice 参数，其余参数与 checker 保持不变。
     */
    updateShippingMethodShippingPrice(ctx: RequestContext, id: ID, shippingPrice: number): Promise<any>;
}
