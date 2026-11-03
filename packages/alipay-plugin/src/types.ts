export interface AlipayPluginOptions {
    notifyUrl: string;
    returnUrl?: string;
    signType?: 'RSA2' | 'RSA';
    alipayPublicKey: string;
    /** 支付宝收款方 PID（2088 开头），用于回调 seller_id 校验；未配置时跳过并告警 */
    sellerId?: string;
    auth?: {
        appId?: string;
        privateKey?: string;
        miniProgramAppId?: string;
        devBypass?: boolean;
        devBypassOpenid?: string;
    };
}
