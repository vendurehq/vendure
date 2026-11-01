// P2-4 无人配送通道（接口占位）：只定义服务商清单与适配器契约，
// 本轮不接真实厂商 SDK：mock 走模拟受理（单号带 MOCK 前缀），
// 真实厂商（meituan/xinshiji）返回 unsupported，绝不能伪造「已受理」单号。
// 后续接真实通道时替换 UnmannedDeliveryService.submit 的实现即可，配置与调用方不变。

export interface UnmannedProviderOption {
    code: string;
    name: string;
    /** 是否需要填接口地址（自建/平台中转才需要） */
    needsEndpoint: boolean;
    /** 是否需要填密钥 */
    needsKey: boolean;
}

export const UNMANNED_PROVIDERS: UnmannedProviderOption[] = [
    { code: 'none', name: '未开通', needsEndpoint: false, needsKey: false },
    { code: 'mock', name: '模拟通道（占位）', needsEndpoint: false, needsKey: false },
    { code: 'meituan', name: '美团无人车', needsEndpoint: true, needsKey: true },
    { code: 'xinshiji', name: '新石器无人车', needsEndpoint: true, needsKey: true },
];

export function findUnmannedProvider(code: string): UnmannedProviderOption {
    const normalized = String(code ?? '').trim();
    return UNMANNED_PROVIDERS.find(p => p.code === normalized) ?? UNMANNED_PROVIDERS[0];
}

export interface UnmannedDeliveryResult {
    ok: boolean;
    provider: string;
    providerName: string;
    /**
     * disabled=通道未开启 / unconfigured=缺接口地址或密钥 /
     * rejected=厂商未受理 / accepted=已受理（仅 mock）/
     * unsupported=该服务商尚未接入，未下发运单
     */
    status: 'disabled' | 'unconfigured' | 'rejected' | 'accepted' | 'unsupported';
    requestNo: string | null;
    message: string;
}
