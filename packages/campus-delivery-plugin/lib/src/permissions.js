"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campusPermissionDefinitions = exports.CampusPermissions = void 0;
const core_1 = require("@vendure/core");
exports.CampusPermissions = {
    CampusConfig: 'CampusConfig', // 分区/宿舍楼/履约配置
    CampusAuditRider: 'CampusAuditRider', // 骑手审核
    CampusViewDispatch: 'CampusViewDispatch', // 调度看板（只读）
    CampusDispatch: 'CampusDispatch', // 调度写操作：手动派单/回大厅/异常处置/外部快递推送
    CampusMerchant: 'CampusMerchant', // 商家接单工作台（商家角色专用）
    CampusCodReceipt: 'CampusCodReceipt', // COD 现金收款登记/台账查询
    CampusCodReceiptVoid: 'CampusCodReceiptVoid', // COD 收款作废（主管）
};
exports.campusPermissionDefinitions = [
    { name: 'CampusConfig', description: '校园履约配置' },
    { name: 'CampusAuditRider', description: '骑手招募审核' },
    { name: 'CampusViewDispatch', description: '配送调度看板（只读）' },
    { name: 'CampusDispatch', description: '配送调度操作（派单/改派/异常处置/外部推送）' },
    { name: 'CampusMerchant', description: '商家接单工作台' },
    { name: 'CampusCodReceipt', description: 'COD 现金收款登记与台账查询' },
    { name: 'CampusCodReceiptVoid', description: 'COD 收款记录作废（主管权限）' },
].map(p => new core_1.PermissionDefinition(p));
//# sourceMappingURL=permissions.js.map