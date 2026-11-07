"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DYNAMIC_PRICING = void 0;
exports.parseDynamicPricing = parseDynamicPricing;
exports.quoteDynamicFee = quoteDynamicFee;
/**
 * 动态配送计价（纯函数，便于单测）。
 * 计费 = 分区基价 + 时段高峰加价 + 供需紧张加价 + 手动倍率加价，单笔加价封顶。
 * 满额免配送费在 calculator 层先判定（达标直接 0），不进入本函数。
 */
const campus_time_1 = require("./campus-time");
exports.DEFAULT_DYNAMIC_PRICING = {
    enabled: false,
    peakWindows: [],
    supply: null,
    manualMultiplier: 1,
    maxAddFee: 600,
};
/** 宽松解析后台 JSON：坏值/缺字段一律回退默认，避免坏配置阻断结算 */
function parseDynamicPricing(raw) {
    if (!raw || typeof raw !== 'object')
        return Object.assign(Object.assign({}, exports.DEFAULT_DYNAMIC_PRICING), { peakWindows: [] });
    const r = raw;
    // 未显式启用时忽略其余脏字段，直接回退关闭态
    if (r.enabled !== true)
        return Object.assign(Object.assign({}, exports.DEFAULT_DYNAMIC_PRICING), { peakWindows: [] });
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
    const windows = Array.isArray(r.peakWindows)
        ? r.peakWindows
            .filter((w) => w && typeof w.start === 'string' && typeof w.end === 'string')
            .map((w) => ({
            label: typeof w.label === 'string' ? w.label : undefined,
            start: w.start,
            end: w.end,
            addFee: num(w.addFee, 0),
        }))
        : [];
    const supply = r.supply && typeof r.supply === 'object'
        ? {
            backlogThreshold: num(r.supply.backlogThreshold, 5),
            riderThreshold: typeof r.supply.riderThreshold === 'number' ? r.supply.riderThreshold : null,
            addFee: num(r.supply.addFee, 0),
            releaseBacklog: typeof r.supply.releaseBacklog === 'number' ? r.supply.releaseBacklog : null,
            releaseRiders: typeof r.supply.releaseRiders === 'number' ? r.supply.releaseRiders : null,
        }
        : null;
    return {
        enabled: true,
        peakWindows: windows,
        supply,
        manualMultiplier: Math.min(2, Math.max(1, typeof r.manualMultiplier === 'number' ? r.manualMultiplier : 1)),
        maxAddFee: num(r.maxAddFee, exports.DEFAULT_DYNAMIC_PRICING.maxAddFee),
    };
}
function minutesOfDay(d) {
    // 高峰时段按校园时区（UTC+8）判定，不依赖进程本地时区
    const shifted = new Date(d.getTime() + campus_time_1.CAMPUS_TZ_OFFSET_MS);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m)
        return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59)
        return null;
    return h * 60 + mi;
}
function quoteDynamicFee(args) {
    const { baseFee, config, at, backlog, onlineRiders } = args;
    if (!config.enabled || baseFee <= 0) {
        return { price: baseFee, baseFee, addFee: 0, breakdown: [] };
    }
    const breakdown = [];
    const nowMin = minutesOfDay(at);
    for (const w of config.peakWindows) {
        const s = toMinutes(w.start);
        const e = toMinutes(w.end);
        if (s == null || e == null || w.addFee <= 0)
            continue;
        if (nowMin >= s && nowMin < e) {
            breakdown.push({ key: 'peak', label: w.label || `${w.start}-${w.end}`, fee: w.addFee });
        }
    }
    const sp = config.supply;
    if (sp && sp.addFee > 0) {
        const riders = onlineRiders !== null && onlineRiders !== void 0 ? onlineRiders : 0;
        const hit = backlog >= sp.backlogThreshold
            && (!sp.riderThreshold || sp.riderThreshold <= 0 || riders <= sp.riderThreshold);
        // 滞回回落：积压或骑手已恢复时不再加价，避免临界值来回抖动
        const released = (sp.releaseBacklog != null && backlog <= sp.releaseBacklog)
            || (sp.releaseRiders != null && sp.releaseRiders > 0 && riders >= sp.releaseRiders);
        if (hit && !released) {
            breakdown.push({ key: 'supply', label: '运力紧张', fee: sp.addFee });
        }
    }
    if (config.manualMultiplier > 1) {
        const extra = Math.round(baseFee * (config.manualMultiplier - 1));
        if (extra > 0) {
            breakdown.push({
                key: 'multiplier',
                label: `手动 ${config.manualMultiplier.toFixed(1)}x`,
                fee: extra,
            });
        }
    }
    const rawAdd = breakdown.reduce((s, b) => s + b.fee, 0);
    const addFee = config.maxAddFee > 0 ? Math.min(rawAdd, config.maxAddFee) : rawAdd;
    return { price: baseFee + addFee, baseFee, addFee, breakdown };
}
//# sourceMappingURL=dynamic-pricing.js.map