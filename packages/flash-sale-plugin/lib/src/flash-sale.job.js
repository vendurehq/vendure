"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flashSaleStatusTask = void 0;
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const flash_sale_activity_entity_1 = require("./flash-sale-activity.entity");
const platform_time_1 = require("./platform-time");
/**
 * 秒杀活动状态转换 ScheduledTask。
 *
 * 使用 Vendure 内置 ScheduledTask（v3.3+）替代原 setInterval：
 * - 由 DefaultSchedulerPlugin 在 worker 进程按 cron 周期执行
 * - 多实例下通过 SchedulerStrategy 锁机制保证 only-once，避免多实例重复处理状态转换
 * - 进程重启不丢任务
 *
 * 需在 plugin.ts 的 configuration 中 push 到 config.schedulerOptions.tasks。
 *
 * schedule `* * * * *` = 每分钟一次（与原 setInterval(60s) 频率一致）。
 */
exports.flashSaleStatusTask = new core_1.ScheduledTask({
    id: 'flash-sale-status-transition',
    description: 'Activate upcoming and end expired flash sale activities',
    schedule: '* * * * *',
    timeout: 30 * 1000,
    preventOverlap: true,
    async execute({ injector }) {
        const connection = injector.get(core_1.TransactionalConnection);
        const repo = connection.rawConnection.getRepository(flash_sale_activity_entity_1.FlashSaleActivity);
        // 可选预热：若安装了 redis-stock-plugin 的 StockPrewarmService，则用之
        let stockPrewarmService = null;
        try {
            const { StockPrewarmService } = require('@vendure/redis-stock-plugin');
            stockPrewarmService = injector.get(StockPrewarmService);
        }
        catch (_a) {
            // RedisStockPlugin not installed
        }
        const toActivate = await repo
            .createQueryBuilder('fsa')
            .where('fsa.status = :status', { status: 'upcoming' })
            .andWhere('fsa.startAt <= (now() AT TIME ZONE :platformTz)', {
            platformTz: platform_time_1.PLATFORM_TIME_ZONE,
        })
            .getMany();
        for (const activity of toActivate) {
            activity.status = 'active';
            if (stockPrewarmService) {
                await stockPrewarmService.prewarm(`flash-sale:${activity.id}`, activity.totalStock - activity.soldCount);
            }
            await repo.save(activity);
            core_1.Logger.info(`FlashSaleActivity ${activity.id} activated`, constants_1.loggerCtx);
        }
        const toEnd = await repo
            .createQueryBuilder('fsa')
            .where('fsa.status = :status', { status: 'active' })
            .andWhere('fsa.endAt <= (now() AT TIME ZONE :platformTz)', {
            platformTz: platform_time_1.PLATFORM_TIME_ZONE,
        })
            .getMany();
        for (const activity of toEnd) {
            activity.status = 'ended';
            if (stockPrewarmService) {
                await stockPrewarmService.removePrewarm(`flash-sale:${activity.id}`);
            }
            await repo.save(activity);
            core_1.Logger.info(`FlashSaleActivity ${activity.id} ended`, constants_1.loggerCtx);
        }
        return {
            activated: toActivate.length,
            ended: toEnd.length,
        };
    },
});
//# sourceMappingURL=flash-sale.job.js.map