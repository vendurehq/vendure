"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StageEventFieldResolver = exports.ServiceChannelFieldResolver = exports.RfqFieldResolver = exports.OnebridgeShopResolver = exports.OnebridgeContentFieldResolver = exports.CustomsRecordFieldResolver = exports.onebridgeShopTypeDefs = exports.onebridgeAdminTypeDefs = exports.OnebridgeAdminResolver = void 0;
var admin_resolver_1 = require("./admin.resolver");
Object.defineProperty(exports, "OnebridgeAdminResolver", { enumerable: true, get: function () { return admin_resolver_1.OnebridgeAdminResolver; } });
var schema_1 = require("./schema");
Object.defineProperty(exports, "onebridgeAdminTypeDefs", { enumerable: true, get: function () { return schema_1.onebridgeAdminTypeDefs; } });
Object.defineProperty(exports, "onebridgeShopTypeDefs", { enumerable: true, get: function () { return schema_1.onebridgeShopTypeDefs; } });
var shop_resolver_1 = require("./shop.resolver");
Object.defineProperty(exports, "CustomsRecordFieldResolver", { enumerable: true, get: function () { return shop_resolver_1.CustomsRecordFieldResolver; } });
Object.defineProperty(exports, "OnebridgeContentFieldResolver", { enumerable: true, get: function () { return shop_resolver_1.OnebridgeContentFieldResolver; } });
Object.defineProperty(exports, "OnebridgeShopResolver", { enumerable: true, get: function () { return shop_resolver_1.OnebridgeShopResolver; } });
Object.defineProperty(exports, "RfqFieldResolver", { enumerable: true, get: function () { return shop_resolver_1.RfqFieldResolver; } });
Object.defineProperty(exports, "ServiceChannelFieldResolver", { enumerable: true, get: function () { return shop_resolver_1.ServiceChannelFieldResolver; } });
Object.defineProperty(exports, "StageEventFieldResolver", { enumerable: true, get: function () { return shop_resolver_1.StageEventFieldResolver; } });
//# sourceMappingURL=index.js.map