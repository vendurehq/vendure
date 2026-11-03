export type PaymentMethodCode = 'alipay' | 'wechatpay' | 'douyinpay';
export interface AlipayCredentials {
    appId: string;
    privateKey: string;
    /** 收款方 PID（2088 开头）；配置后回调会校验 seller_id */
    sellerId?: string;
    tradeType?: 'QR' | 'WAP' | 'APP' | 'MINI';
}
export interface WechatpayCredentials {
    appId: string;
    mchId: string;
    publicKey: string;
    privateKey: string;
    apiKey: string;
    serialNo: string;
    tradeType?: 'JSAPI' | 'NATIVE' | 'APP' | 'H5';
    /** 本租户微信支付回调地址（下单时下发给微信，回调也落在该域名）。
     *  按租户配置而非全局 env：各租户商户号的回调域名不同。 */
    notifyUrl?: string;
}
export interface DouyinpayCredentials {
    appId: string;
    appSecret: string;
    mchId: string;
    privateKey: string;
    salt?: string;
    tradeType?: 'QR' | 'WAP' | 'APP' | 'MINI';
}
export interface PayConfig {
    alipay?: AlipayCredentials;
    wechatpay?: WechatpayCredentials;
    douyinpay?: DouyinpayCredentials;
}
export interface PayConfigStruct {
    alipayJson: string;
    wechatpayJson: string;
    douyinpayJson: string;
}
