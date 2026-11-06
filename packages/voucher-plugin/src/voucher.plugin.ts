import { OnApplicationBootstrap } from '@nestjs/common';
import {
    EventBus,
    Logger,
    OrderStateTransitionEvent,
    PluginCommonModule,
    RefundStateTransitionEvent,
    VendurePlugin,
} from '@vendure/core';
import { filter } from 'rxjs/operators';

import { ServiceVoucher } from './service-voucher.entity';
import { VoucherBooking } from './voucher-booking.entity';
import { VOUCHER_PLUGIN_OPTIONS, VoucherPluginOptions } from './voucher.options';
import { VoucherService } from './voucher.service';
import { VoucherAdminResolver } from './voucher.admin.resolver';
import { VoucherShopResolver } from './voucher.shop.resolver';
import { VoucherTablesMigration } from './migrations/migrate-voucher-tables';

const { gql } = require('graphql-tag');

const loggerCtx = 'voucher-plugin';

/** 服务型商品标记：Product.serviceType 非空即视为到店服务券商品（下单免配送/免库存）。 */
const SERVICE_TYPE_CUSTOM_FIELD = {
    name: 'serviceType',
    type: 'string' as const,
    nullable: true,
    public: true,
};

/**
 * 幂等并入自定义字段，按 name 去重（preBootstrapConfig 可能多次执行插件配置）。
 */
function mergeCustomFields<T extends { name: string }>(
    existingFields: T[] | undefined,
    additions: T[] | undefined,
): T[] {
    const names = new Set((existingFields ?? []).map(f => f.name));
    return [...(existingFields ?? []), ...(additions ?? []).filter(f => !names.has(f.name))];
}

/**
 * 共享类型。admin 与 shop 两个 API 各自对独立基底 schema 做扩展，无法互相引用对方声明的类型，
 * 因此所有 plugin 类型必须在两类 schema 中各自声明一遍（阶段27 铁律）。
 */
const voucherTypeDefs = `
    type ServiceVoucher {
        id: ID!
        orderId: ID!
        customerId: ID!
        shopId: ID!
        code: String!
        productVoucherName: String!
        status: String!
        effectiveDays: Int!
        expiresAt: DateTime
        usedAt: DateTime
        refundedAt: DateTime
    }
    type VoucherBooking {
        id: ID!
        voucherId: ID!
        slotAt: DateTime!
        customerCount: Int!
        status: String!
    }
`;

const adminSchema = gql`
    ${voucherTypeDefs}
    extend type Query {
        scanVoucher(code: String!): ServiceVoucher
        myVouchersAdmin: [ServiceVoucher!]!
        voucherBookings(voucherId: ID!): [VoucherBooking!]!
    }
    extend type Mutation {
        redeemVoucher(code: String!): ServiceVoucher!
        extendVoucher(voucherId: ID!, days: Int!): ServiceVoucher!
        exchangeVoucher(voucherId: ID!): ServiceVoucher!
        runExpireScan: Int!
        createBooking(voucherId: ID!, slotAt: DateTime!, customerCount: Int!): VoucherBooking!
    }
`;

const shopSchema = gql`
    ${voucherTypeDefs}
    extend type Query {
        myVouchers: [ServiceVoucher!]!
    }
`;

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: VOUCHER_PLUGIN_OPTIONS, useFactory: () => VoucherPlugin.options },
        VoucherService,
        // 首次上线：随启动幂等补建表（IF NOT EXISTS），synchronize 关闭时同样可用
        VoucherTablesMigration,
    ],
    entities: [ServiceVoucher, VoucherBooking],
    adminApiExtensions: {
        schema: adminSchema,
        resolvers: [VoucherAdminResolver],
    },
    shopApiExtensions: {
        schema: shopSchema,
        resolvers: [VoucherShopResolver],
    },
    configuration: (config) => {
        config.customFields.Product = mergeCustomFields(config.customFields.Product, [
            SERVICE_TYPE_CUSTOM_FIELD,
        ]);
        return config;
    },
    compatibility: '^3.0.0',
})
export class VoucherPlugin implements OnApplicationBootstrap {
    private static options: VoucherPluginOptions = {};

    constructor(private service: VoucherService, private eventBus: EventBus) {}

    static init(options?: VoucherPluginOptions): typeof VoucherPlugin {
        VoucherPlugin.options = options ?? {};
        return VoucherPlugin;
    }

    onApplicationBootstrap(): void {
        // 订单支付成功 → 为服务型商品行生成到店券（幂等）。
        this.eventBus
            .ofType(OrderStateTransitionEvent)
            .pipe(filter(e => e.toState === 'PaymentSettled'))
            .subscribe(e => {
                const orderId = e.order?.id;
                if (orderId == null) return;
                this.service.getOrCreateVouchersForOrder(e.ctx, e.order).catch(err =>
                    Logger.error(err?.message, loggerCtx),
                );
            });
        // 退款结算成功 → 该单 usable 券联动置 refunded。
        this.eventBus
            .ofType(RefundStateTransitionEvent)
            .pipe(filter(e => e.toState === 'Settled'))
            .subscribe(e => {
                const orderId = e.order?.id;
                if (orderId == null) return;
                this.service.markRefundedOnOrder(e.ctx, orderId).catch(err =>
                    Logger.error(err?.message, loggerCtx),
                );
            });
    }
}