"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onebridgePermissionDefinitions = exports.OnebridgePermissions = void 0;
const core_1 = require("@vendure/core");
/** ONE BRIDGE 权限（CT-09 / §9），注册到 config.authOptions.customPermissions */
exports.OnebridgePermissions = {
    RfqManage: 'OnebridgeRfqManage',
    InspectionManage: 'OnebridgeInspectionManage',
    CustomsManage: 'OnebridgeCustomsManage',
    ContentManage: 'OnebridgeContentManage',
};
exports.onebridgePermissionDefinitions = [
    new core_1.PermissionDefinition({
        name: exports.OnebridgePermissions.RfqManage,
        description: 'Manage ONE BRIDGE RFQ, quotes, samples and stage transitions',
    }),
    new core_1.PermissionDefinition({
        name: exports.OnebridgePermissions.InspectionManage,
        description: 'Upload and publish ONE BRIDGE inspection reports',
    }),
    new core_1.PermissionDefinition({
        name: exports.OnebridgePermissions.CustomsManage,
        description: 'Write back ONE BRIDGE customs status and documents',
    }),
    new core_1.PermissionDefinition({
        name: exports.OnebridgePermissions.ContentManage,
        description: 'Manage ONE BRIDGE columns, cases, logistics channels and site blocks',
    }),
];
//# sourceMappingURL=permissions.js.map