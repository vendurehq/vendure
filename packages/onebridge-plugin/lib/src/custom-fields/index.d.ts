import { CustomFields } from '@vendure/core';
import { onebridgeChannelCustomFields } from './channel.custom-fields';
import { onebridgeCustomerCustomFields } from './customer.custom-fields';
import { onebridgeOrderCustomFields } from './order.custom-fields';
import { onebridgeProductCustomFields } from './product.custom-fields';
/**
 * 幂等合并 customFields：configuration 钩子可能被执行多次，
 * 按字段名去重，避免同一字段重复注册导致启动失败。
 */
export declare function mergeCustomFields<T extends {
    name: string;
}>(existingFields: T[] | undefined, additions: T[] | undefined): T[];
export declare function applyOnebridgeCustomFields(customFields: Required<CustomFields>): Required<CustomFields>;
export { onebridgeChannelCustomFields, onebridgeCustomerCustomFields, onebridgeOrderCustomFields, onebridgeProductCustomFields };
