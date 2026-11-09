"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onebridgeProductCustomFields = exports.onebridgeOrderCustomFields = exports.onebridgeCustomerCustomFields = exports.onebridgeChannelCustomFields = void 0;
exports.mergeCustomFields = mergeCustomFields;
exports.applyOnebridgeCustomFields = applyOnebridgeCustomFields;
const channel_custom_fields_1 = require("./channel.custom-fields");
Object.defineProperty(exports, "onebridgeChannelCustomFields", { enumerable: true, get: function () { return channel_custom_fields_1.onebridgeChannelCustomFields; } });
const customer_custom_fields_1 = require("./customer.custom-fields");
Object.defineProperty(exports, "onebridgeCustomerCustomFields", { enumerable: true, get: function () { return customer_custom_fields_1.onebridgeCustomerCustomFields; } });
const order_custom_fields_1 = require("./order.custom-fields");
Object.defineProperty(exports, "onebridgeOrderCustomFields", { enumerable: true, get: function () { return order_custom_fields_1.onebridgeOrderCustomFields; } });
const product_custom_fields_1 = require("./product.custom-fields");
Object.defineProperty(exports, "onebridgeProductCustomFields", { enumerable: true, get: function () { return product_custom_fields_1.onebridgeProductCustomFields; } });
/**
 * 幂等合并 customFields：configuration 钩子可能被执行多次，
 * 按字段名去重，避免同一字段重复注册导致启动失败。
 */
function mergeCustomFields(existingFields, additions) {
    const names = new Set((existingFields !== null && existingFields !== void 0 ? existingFields : []).map(f => f.name));
    return [...(existingFields !== null && existingFields !== void 0 ? existingFields : []), ...(additions !== null && additions !== void 0 ? additions : []).filter(f => !names.has(f.name))];
}
function applyOnebridgeCustomFields(customFields) {
    return Object.assign(Object.assign({}, customFields), { Order: mergeCustomFields(customFields.Order, order_custom_fields_1.onebridgeOrderCustomFields.Order), Customer: mergeCustomFields(customFields.Customer, customer_custom_fields_1.onebridgeCustomerCustomFields.Customer), Channel: mergeCustomFields(customFields.Channel, channel_custom_fields_1.onebridgeChannelCustomFields.Channel), Product: mergeCustomFields(customFields.Product, product_custom_fields_1.onebridgeProductCustomFields.Product), ProductVariant: mergeCustomFields(customFields.ProductVariant, product_custom_fields_1.onebridgeProductCustomFields.ProductVariant) });
}
//# sourceMappingURL=index.js.map