import { describe, expect, it } from 'vitest';

import { CARRIER_NAMES, resolveCarrierName } from '../services/carrier-dictionary';

describe('承运商字典（B-16）', () => {
    it('命中韩国 / 中国 / 国际常用 code', () => {
        expect(resolveCarrierName('cj')).toBe('CJ대한통운');
        expect(resolveCarrierName('CJ')).toBe('CJ대한통운');
        expect(resolveCarrierName('sf')).toBe('顺丰速运');
        expect(resolveCarrierName('EMS')).toBe('中国邮政 EMS');
        expect(resolveCarrierName('dhl')).toBe('DHL');
    });

    it('归一化：去空白/下划线、大小写不敏感', () => {
        expect(resolveCarrierName('SF Express')).toBe('顺丰速运');
        expect(resolveCarrierName('CJ_Logistics')).toBe('CJ대한통운');
        expect(resolveCarrierName(' korea post ')).toBe('우체국택배');
    });

    it('字典未命中一律 null（不改 status 口径）', () => {
        expect(resolveCarrierName('unknown-carrier')).toBeNull();
        expect(resolveCarrierName('')).toBeNull();
        expect(resolveCarrierName(null)).toBeNull();
        expect(resolveCarrierName(undefined)).toBeNull();
    });

    it('字典只增不改：既有 code 保持稳定', () => {
        expect(CARRIER_NAMES.cj).toBe('CJ대한통운');
        expect(CARRIER_NAMES['sf-express']).toBe('顺丰速运');
    });
});
