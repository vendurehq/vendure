import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { withAdvisoryLock } from './advisory-lock';
import { PeriodicFallback } from './periodic-fallback';
import { RiderWalletService } from './rider-wallet.service';

/**
 * R1 提现意图对账任务：提现申请先落库（intent）再扣款，若进程在扣款/确认之间中断，
 * 申请会停在 intent。本任务按余额流水 remark=withdraw:<id> 还原真实扣款结果并自动收敛。
 */
@Injectable()
export class WithdrawReconcileJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;

    constructor(private wallet: RiderWalletService, private connection: TransactionalConnection) {}

    start(intervalMs = 5 * 60_000) {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({
            name: 'withdraw-reconcile',
            intervalMs,
            loggerCtx: 'CampusWallet',
        });
        this.fallback.start(async () => {
            // 多实例互斥：拿不到锁说明其他实例正在对账，本轮直接跳过（避免同一 intent 被并发重复收敛）
            await withAdvisoryLock(this.connection, 'campus:withdraw-reconcile', () =>
                this.wallet.reconcileWithdrawIntents(),
            );
        });
    }

    onApplicationShutdown() {
        this.fallback?.stop();
        this.fallback = null;
    }
}
