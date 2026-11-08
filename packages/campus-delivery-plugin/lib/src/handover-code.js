"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HANDOVER_CODE_TTL_MS = void 0;
exports.generateHandoverCode = generateHandoverCode;
exports.isHandoverCodeExpired = isHandoverCodeExpired;
/**
 * 交接码统一规则（A2/A3）：生成、有效期判定集中在此，避免各处漂移。
 *
 * 有效期取 10 分钟：交接码是「对餐凭证」，只在骑手取货这一刻需要核验，
 * 10 分钟足以覆盖“到店→核对→取走”的正常耗时；再长会扩大旧码被复用/冒领的窗口。
 *
 * 与自动强派阈值（autoAssignMinutes，生产 10 分钟）是两件事，A2 的做法是
 * 在派单成功时重新签发（见 hall-grab.service），而不是把 TTL 拉长去迁就强派时间：
 * 拉长 TTL 会让“凭证”在骑手还没拿到餐时长期有效，语义更差，且仍解决不了历史码在派单时已过期的问题。
 */
exports.HANDOVER_CODE_TTL_MS = 10 * 60000;
/** 生成 4 位数字交接码（1000–9999，首位不为 0，便于商家/骑手口头核对） */
function generateHandoverCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}
/**
 * 交接码是否已过期。
 * - 无签发时间（历史单/未记录）按「未过期」处理，与既有行为一致，避免老单突然全部拒绝；
 * - 边界：恰好等于 TTL 仍有效，超过 TTL 才算过期。
 */
function isHandoverCodeExpired(issuedAt, now = Date.now()) {
    let t = NaN;
    if (issuedAt instanceof Date) {
        t = issuedAt.getTime();
    }
    else if (typeof issuedAt === 'number') {
        t = issuedAt;
    }
    else if (typeof issuedAt === 'string' && issuedAt.trim()) {
        // 兼容 pg 驱动可能回传的字符串时间（数字毫秒或 ISO）
        t = Number(issuedAt);
        if (!Number.isFinite(t))
            t = Date.parse(issuedAt);
    }
    return Number.isFinite(t) && now - t > exports.HANDOVER_CODE_TTL_MS;
}
//# sourceMappingURL=handover-code.js.map