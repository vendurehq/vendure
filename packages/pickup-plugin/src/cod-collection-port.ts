import { RequestContext } from '@vendure/core';

/** 到店自取 COD 柜台收款登记输入（金额由门店按本单 COD 应收金额确认） */
export interface CodCounterCollectionInput {
    amount: number;
    collectedByUserId?: number | null;
    collectedByName?: string | null;
}

/** COD 收款台账能力端口：由 campus-delivery-plugin 在启动时可选注册（与 coupon-balance-port 同模式）。 */
export interface CodCollectionPort {
    recordCounterCollection(
        ctx: RequestContext,
        orderId: number | string,
        input: CodCounterCollectionInput,
    ): Promise<{ receiptId: number; amount: number } | void>;
}

let port: CodCollectionPort | null = null;

export function setCodCollectionPort(p: CodCollectionPort | null): void {
    port = p;
}

export function getCodCollectionPort(): CodCollectionPort | null {
    return port;
}
