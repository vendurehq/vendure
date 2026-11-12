"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const carrier_dictionary_1 = require("../services/carrier-dictionary");
(0, vitest_1.describe)('承运商字典（B-16）', () => {
    (0, vitest_1.it)('命中韩国 / 中国 / 国际常用 code', () => {
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('cj')).toBe('CJ대한통운');
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('CJ')).toBe('CJ대한통운');
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('sf')).toBe('顺丰速运');
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('EMS')).toBe('中国邮政 EMS');
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('dhl')).toBe('DHL');
    });
    (0, vitest_1.it)('归一化：去空白/下划线、大小写不敏感', () => {
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('SF Express')).toBe('顺丰速运');
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('CJ_Logistics')).toBe('CJ대한통운');
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)(' korea post ')).toBe('우체국택배');
    });
    (0, vitest_1.it)('字典未命中一律 null（不改 status 口径）', () => {
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('unknown-carrier')).toBeNull();
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)('')).toBeNull();
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)(null)).toBeNull();
        (0, vitest_1.expect)((0, carrier_dictionary_1.resolveCarrierName)(undefined)).toBeNull();
    });
    (0, vitest_1.it)('字典只增不改：既有 code 保持稳定', () => {
        (0, vitest_1.expect)(carrier_dictionary_1.CARRIER_NAMES.cj).toBe('CJ대한통운');
        (0, vitest_1.expect)(carrier_dictionary_1.CARRIER_NAMES['sf-express']).toBe('顺丰速运');
    });
});
//# sourceMappingURL=carrier-dictionary.spec.js.map