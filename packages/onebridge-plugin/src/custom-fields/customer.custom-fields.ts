import { CustomFields, LanguageCode } from '@vendure/core';

import { CUSTOMER_TIERS } from '../types';

const zh = (value: string) => ({ languageCode: LanguageCode.zh_Hans, value });
const ko = (value: string) => ({ languageCode: LanguageCode.ko, value });

/**
 * 客户资料与分级（CT-08）。
 * tier 取值含韩文，GraphQL 枚举不允许非 ASCII，故以 string + options 存储；
 * 企业客户分级用 Customer customFields + CustomerGroup，不误用 EmployeeCustomer。
 */
export const onebridgeCustomerCustomFields: CustomFields = {
    Customer: [
        {
            name: 'tier',
            type: 'string',
            nullable: true,
            public: true,
            label: [zh('客户分级'), ko('고객 등급')],
            options: CUSTOMER_TIERS.map(value => ({
                value,
                label: [zh(value), ko(value)],
            })),
        },
        { name: 'companyName', type: 'string', nullable: true, label: [zh('企业名称'), ko('회사명')] },
        { name: 'businessNo', type: 'string', nullable: true, label: [zh('韩国营业执照号'), ko('사업자등록번호')] },
        { name: 'kakaoId', type: 'string', nullable: true, label: [zh('KakaoTalk ID'), ko('카카오톡 ID')] },
        {
            name: 'preferredLocale',
            type: 'string',
            nullable: true,
            defaultValue: 'ko',
            label: [zh('首选语言'), ko('선호 언어')],
            options: [
                { value: 'ko', label: [zh('韩语'), ko('한국어')] },
                { value: 'zh', label: [zh('中文'), ko('중국어')] },
            ],
        },
        { name: 'addressKr', type: 'string', nullable: true, label: [zh('韩国收货地址'), ko('한국 배송지')] },
        { name: 'verified', type: 'boolean', defaultValue: false, label: [zh('资质已核验'), ko('자격 검증 완료')] },
    ],
};
