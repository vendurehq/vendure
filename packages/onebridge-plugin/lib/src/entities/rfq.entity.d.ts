import { DeepPartial, VendureEntity } from '@vendure/core';
import { BusinessLine, CrossBorderStage, LocaleCode, NeedType } from '../types';
/**
 * RFQ 询价单（CT-02）。
 * 独立单据，不生成 Vendure Order；handler/报价/样品分开建表，不做外键，应用层按 rfqId 关联。
 */
export declare class Rfq extends VendureEntity {
    constructor(input?: DeepPartial<Rfq>);
    /** 受理编号 OB-YYYYMMDD-XXXX，唯一索引兜底并发 */
    code: string;
    /** 渠道 token（所有查询按渠道隔离） */
    channelToken: string;
    needType: NeedType;
    /** 中文展示名，如「精选专栏询价」 */
    needLabel: string;
    /** 原型为「姓名或公司名」合一，不另设 company */
    customerName: string;
    /** 电话/邮箱/카카오톡/微信，允许多种混填 */
    customerContact: string;
    locale: LocaleCode;
    item: string;
    /** 「10개 / ₩1,000,000」自由文本，不拆数值 */
    qty: string | null;
    /** 「11월 말」自由文本，不解析日期 */
    eta: string | null;
    memo: string | null;
    stage: CrossBorderStage;
    /** collections→pond / projects→hook；logistics 为 null */
    businessLine: BusinessLine | null;
    assignedTeam: string | null;
    /** 登录客户 id；游客询价可为空 */
    customerId: number | null;
    /** 幂等键：重复 submitRfq 命中唯一索引时返回原单，不产生副作用 */
    idempotencyKey: string | null;
}
