import { DeepPartial, VendureEntity } from '@vendure/core';
import { InspectionResult } from '../types';
/** 验货报告（CT-07），编号 QC-YYYYMMDD-NNNN；照片走 OSS URL 列表 */
export declare class InspectionReport extends VendureEntity {
    constructor(input?: DeepPartial<InspectionReport>);
    code: string;
    orderCode: string | null;
    rfqCode: string | null;
    inspector: string;
    inspectedAt: Date;
    result: InspectionResult;
    /** 照片 URL 数组（OSS） */
    photos: string[] | null;
    notesKr: string | null;
    notesCn: string | null;
    /** 是否放行；未通过不放行只由阶段跃迁校验执行，不靠前端隐藏按钮 */
    passed: boolean;
    /** 发布后 C 端才可见 */
    publishedAt?: Date;
}
