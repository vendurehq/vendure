import { DeepPartial, VendureEntity } from '@vendure/core';
import { CrossBorderStage, StageEventState, StageOwnerType } from '../types';
/**
 * 阶段事件（CT-10）：业务时间轴的唯一数据源，RFQ 与订单共用。
 * 每次阶段跃迁写一条；idempotencyKey 唯一，重复回写不产生重复节点。
 */
export declare class StageEvent extends VendureEntity {
    constructor(input?: DeepPartial<StageEvent>);
    ownerType: StageOwnerType;
    /** 归属单号（RFQ code / Order code） */
    ownerCode: string;
    stage: CrossBorderStage;
    titleKr: string;
    titleCn: string;
    descKr: string | null;
    descCn: string | null;
    state: StageEventState;
    occurredAt: Date;
    /** 操作人（后台账号名 / system） */
    operator: string | null;
    /** 幂等键：轨迹/清关重复回写以唯一索引兜底 */
    idempotencyKey: string | null;
}
