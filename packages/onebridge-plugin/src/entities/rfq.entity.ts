import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { BusinessLine, CrossBorderStage, LocaleCode, NeedType } from '../types';

/**
 * RFQ 询价单（CT-02）。
 * 独立单据，不生成 Vendure Order；handler/报价/样品分开建表，不做外键，应用层按 rfqId 关联。
 */
@Entity('onebridge_rfq')
@Index(['channelToken', 'needType', 'stage'])
@Index(['customerId', 'createdAt'])
export class Rfq extends VendureEntity {
    constructor(input?: DeepPartial<Rfq>) {
        super(input);
    }

    /** 受理编号 OB-YYYYMMDD-XXXX，唯一索引兜底并发 */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 32 })
    code: string;

    /** 渠道 token（所有查询按渠道隔离） */
    @Column({ type: 'varchar', length: 64 })
    channelToken: string;

    @Column({ type: 'varchar', length: 16 })
    needType: NeedType;

    /** 中文展示名，如「精选专栏询价」 */
    @Column({ type: 'varchar', length: 64 })
    needLabel: string;

    /** 原型为「姓名或公司名」合一，不另设 company */
    @Column({ type: 'varchar', length: 100 })
    customerName: string;

    /** 电话/邮箱/카카오톡/微信，允许多种混填 */
    @Column({ type: 'varchar', length: 200 })
    customerContact: string;

    @Column({ type: 'varchar', length: 4 })
    locale: LocaleCode;

    @Column({ type: 'text' })
    item: string;

    /** 「10개 / ₩1,000,000」自由文本，不拆数值 */
    @Column({ type: 'varchar', length: 200, nullable: true })
    qty: string | null;

    /** 「11월 말」自由文本，不解析日期 */
    @Column({ type: 'varchar', length: 100, nullable: true })
    eta: string | null;

    @Column({ type: 'text', nullable: true })
    memo: string | null;

    @Column({ type: 'varchar', length: 16 })
    stage: CrossBorderStage;

    /** collections→pond / projects→hook；logistics 为 null */
    @Column({ type: 'varchar', length: 8, nullable: true })
    businessLine: BusinessLine | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    assignedTeam: string | null;

    /** 登录客户 id；游客询价可为空 */
    @Index()
    @Column({ type: 'int', nullable: true })
    customerId: number | null;

    /** 幂等键：重复 submitRfq 命中唯一索引时返回原单，不产生副作用 */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 128, nullable: true })
    idempotencyKey: string | null;
}
