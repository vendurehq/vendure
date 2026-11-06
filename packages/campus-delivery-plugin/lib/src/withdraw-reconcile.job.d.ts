import { OnApplicationShutdown } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { RiderWalletService } from './rider-wallet.service';
/**
 * R1 提现意图对账任务：提现申请先落库（intent）再扣款，若进程在扣款/确认之间中断，
 * 申请会停在 intent。本任务按余额流水 remark=withdraw:<id> 还原真实扣款结果并自动收敛。
 */
export declare class WithdrawReconcileJob implements OnApplicationShutdown {
    private wallet;
    private connection;
    private fallback;
    constructor(wallet: RiderWalletService, connection: TransactionalConnection);
    start(intervalMs?: number): void;
    onApplicationShutdown(): void;
}
