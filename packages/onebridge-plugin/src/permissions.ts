import { PermissionDefinition } from '@vendure/core';

/** ONE BRIDGE 权限（CT-09 / §9），注册到 config.authOptions.customPermissions */
export const OnebridgePermissions = {
    RfqManage: 'OnebridgeRfqManage',
    InspectionManage: 'OnebridgeInspectionManage',
    CustomsManage: 'OnebridgeCustomsManage',
    ContentManage: 'OnebridgeContentManage',
} as const;

export const onebridgePermissionDefinitions: PermissionDefinition[] = [
    new PermissionDefinition({
        name: OnebridgePermissions.RfqManage,
        description: 'Manage ONE BRIDGE RFQ, quotes, samples and stage transitions',
    }),
    new PermissionDefinition({
        name: OnebridgePermissions.InspectionManage,
        description: 'Upload and publish ONE BRIDGE inspection reports',
    }),
    new PermissionDefinition({
        name: OnebridgePermissions.CustomsManage,
        description: 'Write back ONE BRIDGE customs status and documents',
    }),
    new PermissionDefinition({
        name: OnebridgePermissions.ContentManage,
        description: 'Manage ONE BRIDGE columns, cases, logistics channels and site blocks',
    }),
];
