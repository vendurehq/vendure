"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WithdrawReconcileJob = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const advisory_lock_1 = require("./advisory-lock");
const periodic_fallback_1 = require("./periodic-fallback");
const rider_wallet_service_1 = require("./rider-wallet.service");
/**
 * R1 提现意图对账任务：提现申请先落库（intent）再扣款，若进程在扣款/确认之间中断，
 * 申请会停在 intent。本任务按余额流水 remark=withdraw:<id> 还原真实扣款结果并自动收敛。
 */
let WithdrawReconcileJob = class WithdrawReconcileJob {
    constructor(wallet, connection) {
        this.wallet = wallet;
        this.connection = connection;
        this.fallback = null;
    }
    start(intervalMs = 5 * 60000) {
        if (this.fallback)
            return;
        this.fallback = new periodic_fallback_1.PeriodicFallback({
            name: 'withdraw-reconcile',
            intervalMs,
            loggerCtx: 'CampusWallet',
        });
        this.fallback.start(async () => {
            // 多实例互斥：拿不到锁说明其他实例正在对账，本轮直接跳过（避免同一 intent 被并发重复收敛）
            await (0, advisory_lock_1.withAdvisoryLock)(this.connection, 'campus:withdraw-reconcile', () => this.wallet.reconcileWithdrawIntents());
        });
    }
    onApplicationShutdown() {
        var _a;
        (_a = this.fallback) === null || _a === void 0 ? void 0 : _a.stop();
        this.fallback = null;
    }
};
exports.WithdrawReconcileJob = WithdrawReconcileJob;
exports.WithdrawReconcileJob = WithdrawReconcileJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [rider_wallet_service_1.RiderWalletService, core_1.TransactionalConnection])
], WithdrawReconcileJob);
//# sourceMappingURL=withdraw-reconcile.job.js.map