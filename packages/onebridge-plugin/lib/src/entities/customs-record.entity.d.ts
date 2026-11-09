import { DeepPartial, VendureEntity } from '@vendure/core';
import { CustomsStatus } from '../types';
/**
 * 清关记录（CT-06）：按订单号唯一，补充 logistics-plugin 轨迹实体缺失的清关字段。
 * 不改既有 logistics-track 表，避免影响 e.joho.cn 既有租户。
 */
export declare class CustomsRecord extends VendureEntity {
    constructor(input?: DeepPartial<CustomsRecord>);
    orderCode: string;
    customsStatus: CustomsStatus;
    declaredAt?: Date;
    clearedAt?: Date;
    hsCode: string | null;
    declarationNo: string | null;
    note: string | null;
    /** 清关单证 URL 数组 */
    docs: string[] | null;
    /** 最后一次同步时间（幂等回写判定依据） */
    lastSyncedAt?: Date;
    idempotencyKey: string | null;
}
