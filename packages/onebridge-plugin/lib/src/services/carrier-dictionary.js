"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARRIER_NAMES = void 0;
exports.resolveCarrierName = resolveCarrierName;
/**
 * 承运商字典（B-16）：carrierCode → 展示名。
 *
 * 口径（契约冻结 §0 / CT-09）：
 * - `carrierCode` 原样返回物流插件写入的值，不做大小写/别名改写；
 * - 字典命不中时 `carrierName` 返回 null（C 端按「未知承运商」占位），
 *   `status` 仍按 logistics_track 原值返回、缺省 `unknown`，语义不改；
 * - 新增承运商只在本文件补一行，不动接口与返回形状。
 *
 * 注意：韩国段（CJ/한진/롯데/우체국）与中韩干线（SF/EMS/DHL 等）是跨境主链路，
 * 优先覆盖；国内快递补常用项。
 */
exports.CARRIER_NAMES = {
    // 韩国
    cj: 'CJ대한통운',
    'cj-logistics': 'CJ대한통운',
    hanjin: '한진택배',
    lotte: '롯데택배',
    epost: '우체국택배',
    koreapost: '우체국택배',
    'korea-post': '우체국택배',
    cjgls: 'CJ GLS',
    koreaexpress: 'Korea Express',
    // 中国 / 跨境干线
    sf: '顺丰速运',
    'sf-express': '顺丰速运',
    yto: '圆通速递',
    zto: '中通快递',
    yunda: '韵达速递',
    sto: '申通快递',
    ems: '中国邮政 EMS',
    'china-post': '中国邮政',
    jd: '京东物流',
    dbk: '德邦快递',
    // 国际
    dhl: 'DHL',
    fedex: 'FedEx',
    ups: 'UPS',
    tnt: 'TNT',
};
/**
 * 按 carrierCode 取承运商展示名。
 * 命中规则：先原样、再小写、再去掉空白/下划线后的归一化键；都不中返回 null。
 */
function resolveCarrierName(carrierCode) {
    var _a, _b;
    if (!carrierCode) {
        return null;
    }
    const raw = carrierCode.trim();
    if (!raw) {
        return null;
    }
    const direct = (_a = exports.CARRIER_NAMES[raw]) !== null && _a !== void 0 ? _a : exports.CARRIER_NAMES[raw.toLowerCase()];
    if (direct) {
        return direct;
    }
    const normalized = raw.toLowerCase().replace(/[\s_]+/g, '-');
    return (_b = exports.CARRIER_NAMES[normalized]) !== null && _b !== void 0 ? _b : null;
}
//# sourceMappingURL=carrier-dictionary.js.map