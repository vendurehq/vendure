import { ID, RequestContext } from '@vendure/core';
import { CodCollectionService, RegisterCodReceiptInput } from './cod-receipt.service';
/** 运营/客服：COD 收款登记、台账查询；作废需主管权限（CampusCodReceiptVoid） */
export declare class CodReceiptAdminResolver {
    private codCollection;
    constructor(codCollection: CodCollectionService);
    campusCodReceipts(ctx: RequestContext, orderId?: ID): Promise<import("./cod-receipt.entities").CampusCodReceipt[]>;
    campusRegisterCodReceipt(ctx: RequestContext, orderId: ID, input: RegisterCodReceiptInput): Promise<import("./cod-receipt.entities").CampusCodReceipt>;
    campusVoidCodReceipt(ctx: RequestContext, receiptId: ID, reason: string): Promise<import("./cod-receipt.entities").CampusCodReceipt>;
}
