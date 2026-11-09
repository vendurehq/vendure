import { DeepPartial, VendureEntity } from '@vendure/core';
/** RFQ 样品记录（CT-02 RfqSample） */
export declare class RfqSample extends VendureEntity {
    constructor(input?: DeepPartial<RfqSample>);
    rfqId: number;
    status: string;
    trackingNo: string | null;
    confirmedAt?: Date;
}
