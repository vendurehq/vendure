"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSeedSteps = runSeedSteps;
exports.findTenantNoOccupant = findTenantNoOccupant;
const core_1 = require("@vendure/core");
const constants_1 = require("../constants");
/**
 * 按步骤隔离执行默认数据播种。
 *
 * 背景：原实现把所有步骤包在一个 try/catch 里，任何一个步骤失败（例如全局配送档案
 * 需要 SuperAdmin 权限）都会让后续步骤（含官方租户播种）全部不执行，且只留一条笼统日志。
 *
 * 现在的约定：
 * - 单步失败只记录「步骤名 + 真实错误」，继续执行后续步骤；
 * - 全部跑完后如果存在失败，再记一条汇总日志列出全部失败步骤名；
 * - 返回失败步骤名数组（空数组=全部成功），供单测与启动日志使用。
 *
 * 注意：这里是「隔离」不是「吞掉」——失败步骤一定有 error 级日志，且汇总日志里能一眼看到步骤名。
 */
async function runSeedSteps(ctx, steps) {
    var _a;
    const failed = [];
    for (const step of steps) {
        try {
            await step.run(ctx);
        }
        catch (e) {
            failed.push(step.name);
            core_1.Logger.error(`默认数据步骤失败 [${step.name}]: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
        }
    }
    if (failed.length) {
        core_1.Logger.error(`默认数据初始化完成但有 ${failed.length} 个步骤失败: ${failed.join('、')}（详细原因见上方各步骤日志）`, constants_1.loggerCtx);
    }
    else {
        core_1.Logger.info('购物配送/支付默认数据初始化完成', constants_1.loggerCtx);
    }
    return failed;
}
/**
 * 查找某个 tenantNo 的现有占用者。
 *
 * 数据库上 tenantNo 只是 channel 的自定义字段，**没有唯一约束**，
 * 因此「业务租户先占了官方位」不会在写入时报错，只会静默出现两个渠道同号。
 * 官方租户播种前必须先做这个检测，冲突时跳过该号位并打 error 日志。
 */
function findTenantNoOccupant(channels, tenantNo) {
    var _a;
    const hit = channels.find(c => { var _a; return Number((_a = c.customFields) === null || _a === void 0 ? void 0 : _a.tenantNo) === tenantNo; });
    if (!hit)
        return undefined;
    return {
        code: String(hit.code),
        isOfficial: ((_a = hit.customFields) === null || _a === void 0 ? void 0 : _a.isOfficial) === true,
    };
}
//# sourceMappingURL=seed-steps.js.map