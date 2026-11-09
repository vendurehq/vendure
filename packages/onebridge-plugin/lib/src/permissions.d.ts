import { PermissionDefinition } from '@vendure/core';
/** ONE BRIDGE 权限（CT-09 / §9），注册到 config.authOptions.customPermissions */
export declare const OnebridgePermissions: {
    readonly RfqManage: "OnebridgeRfqManage";
    readonly InspectionManage: "OnebridgeInspectionManage";
    readonly CustomsManage: "OnebridgeCustomsManage";
    readonly ContentManage: "OnebridgeContentManage";
};
export declare const onebridgePermissionDefinitions: PermissionDefinition[];
