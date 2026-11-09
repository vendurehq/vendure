"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnebridgePlugin = void 0;
var plugin_1 = require("./plugin");
Object.defineProperty(exports, "OnebridgePlugin", { enumerable: true, get: function () { return plugin_1.OnebridgePlugin; } });
__exportStar(require("./types"), exports);
__exportStar(require("./stages"), exports);
__exportStar(require("./codes"), exports);
__exportStar(require("./transitions"), exports);
__exportStar(require("./errors"), exports);
__exportStar(require("./permissions"), exports);
__exportStar(require("./custom-fields"), exports);
__exportStar(require("./entities"), exports);
__exportStar(require("./migrations"), exports);
//# sourceMappingURL=index.js.map