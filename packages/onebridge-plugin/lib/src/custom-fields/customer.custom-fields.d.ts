import { CustomFields } from '@vendure/core';
/**
 * 客户资料与分级（CT-08）。
 * tier 取值含韩文，GraphQL 枚举不允许非 ASCII，故以 string + options 存储；
 * 企业客户分级用 Customer customFields + CustomerGroup，不误用 EmployeeCustomer。
 */
export declare const onebridgeCustomerCustomFields: CustomFields;
