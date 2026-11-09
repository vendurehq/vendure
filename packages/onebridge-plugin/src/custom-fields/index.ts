import { CustomFields } from '@vendure/core';

import { onebridgeChannelCustomFields } from './channel.custom-fields';
import { onebridgeCustomerCustomFields } from './customer.custom-fields';
import { onebridgeOrderCustomFields } from './order.custom-fields';
import { onebridgeProductCustomFields } from './product.custom-fields';

/**
 * 幂等合并 customFields：configuration 钩子可能被执行多次，
 * 按字段名去重，避免同一字段重复注册导致启动失败。
 */
export function mergeCustomFields<T extends { name: string }>(
    existingFields: T[] | undefined,
    additions: T[] | undefined,
): T[] {
    const names = new Set((existingFields ?? []).map(f => f.name));
    return [...(existingFields ?? []), ...(additions ?? []).filter(f => !names.has(f.name))];
}

export function applyOnebridgeCustomFields(customFields: Required<CustomFields>): Required<CustomFields> {
    return {
        ...customFields,
        Order: mergeCustomFields(customFields.Order, onebridgeOrderCustomFields.Order),
        Customer: mergeCustomFields(customFields.Customer, onebridgeCustomerCustomFields.Customer),
        Channel: mergeCustomFields(customFields.Channel, onebridgeChannelCustomFields.Channel),
        Product: mergeCustomFields(customFields.Product, onebridgeProductCustomFields.Product),
        ProductVariant: mergeCustomFields(
            customFields.ProductVariant,
            onebridgeProductCustomFields.ProductVariant,
        ),
    };
}

export { onebridgeChannelCustomFields, onebridgeCustomerCustomFields, onebridgeOrderCustomFields, onebridgeProductCustomFields };
