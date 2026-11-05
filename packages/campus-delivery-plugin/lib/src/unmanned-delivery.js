"use strict";
// P2-4 无人配送通道（接口占位）：只定义服务商清单与适配器契约，
// 本轮不接真实厂商 SDK：mock 走模拟受理（单号带 MOCK 前缀），
// 真实厂商（meituan/xinshiji）返回 unsupported，绝不能伪造「已受理」单号。
// 后续接真实通道时替换 UnmannedDeliveryService.submit 的实现即可，配置与调用方不变。
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNMANNED_PROVIDERS = void 0;
exports.findUnmannedProvider = findUnmannedProvider;
exports.UNMANNED_PROVIDERS = [
    { code: 'none', name: '未开通', needsEndpoint: false, needsKey: false, integrated: false },
    { code: 'mock', name: '模拟通道（占位）', needsEndpoint: false, needsKey: false, integrated: true },
    { code: 'meituan', name: '美团无人车', needsEndpoint: true, needsKey: true, integrated: false },
    { code: 'xinshiji', name: '新石器无人车', needsEndpoint: true, needsKey: true, integrated: false },
];
function findUnmannedProvider(code) {
    var _a;
    const normalized = String(code !== null && code !== void 0 ? code : '').trim();
    return (_a = exports.UNMANNED_PROVIDERS.find(p => p.code === normalized)) !== null && _a !== void 0 ? _a : exports.UNMANNED_PROVIDERS[0];
}
//# sourceMappingURL=unmanned-delivery.js.map