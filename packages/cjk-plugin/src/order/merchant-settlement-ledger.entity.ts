import { Column, Entity, Index } from 'typeorm';
import { DeepPartial, VendureEntity } from '@vendure/core';

/**
 * 商户分账台账（Merchant Settlement Ledger）：「per-box checkout」的台账级分账记录。
 *
 * 结算拆单时，为一笔已结算订单下的**每个商户（租户）**各记录一行——该订单应付该商户的金额。
 * 通道级分账（向第三方支付通道请求实际拆账/代付/进件）明确不在本表范围内，本表仅作为分账依据。
 *
 * `status`：
 * - `PAID`：在线支付（余额钱包 / 支付宝 / 微信等）在结算时即已收款；
 * - `PENDING_SIGN`：货到付款（COD）结算时尚未实质收款，待「签收事件」触发后翻转为 `PAID`。
 *   PENDING_SIGN → PAID 的翻转接线属后续细化（chore），此处仅占位，并留状态值以便后续翻转。
 *
 * `createdAt` / `updatedAt` 由 VendureEntity 基类提供（CreateDateColumn / UpdateDateColumn）。
 * `id`（自增 int 主键）亦由 VendureEntity 基类提供。
 */
@Entity('merchant_settlement_ledger')
export class MerchantSettlementLedger extends VendureEntity {
    constructor(input?: DeepPartial<MerchantSettlementLedger>) {
        super(input);
    }

    /** 关联的一笔已结算订单 id */
    @Index()
    @Column({ type: 'varchar' })
    orderId: string;

    /** 应付商户（租户）渠道 id */
    @Index()
    @Column({ type: 'varchar' })
    tenantChannelId: string;

    /** 商户（租户）名，写台账时的冗余快照（避免后续渠道改名/删除导致台账失联） */
    @Column({ type: 'varchar', nullable: true })
    tenantName: string | null;

    /** 该订单应付该商户的金额。Money 语义，int 列存储，单位与插件金额合计一致（即 MerchantSplit.amount）。 */
    @Column({ type: 'int', default: 0 })
    amount: number;

    /** 所选支付方式 code（如 balance-wallet / cash-on-delivery / alipay / wechatpay） */
    @Column({ type: 'varchar', nullable: true })
    settleMethod: string | null;

    /** 分账状态：PAID（在线已收）| PENDING_SIGN（货到付款待签收） */
    @Column({ type: 'varchar', nullable: true })
    status: string | null;

    /** 记账 / 收款时点 */
    @Column({ type: 'timestamptz' })
    occurredAt: Date;

    /** 核销/收款渠道 id：到店收款归属的收款方（门店/租户）渠道；在线分账行为空 */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    collectorChannelId: string | null;

    /** 核销人 / 收款人显示名（核销并确认收款时的经手人；核销人即收款人） */
    @Column({ type: 'varchar', nullable: true })
    collectorName: string | null;

    /** 订单单号冗余快照（展示用，避免每次 join 订单） */
    @Column({ type: 'varchar', nullable: true })
    orderCode: string | null;

    /** 到店核销收款确认时点（区别于 occurredAt 记账时点） */
    @Column({ type: 'timestamptz', nullable: true })
    collectedAt: Date | null;
}