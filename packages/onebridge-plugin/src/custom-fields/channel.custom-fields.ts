import { CustomFields, LanguageCode } from '@vendure/core';

const zh = (value: string) => ({ languageCode: LanguageCode.zh_Hans, value });
const ko = (value: string) => ({ languageCode: LanguageCode.ko, value });

/** 渠道级跨境配置（CT-03）：四个前台业务频道的内容与启停 */
export const onebridgeChannelCustomFields: CustomFields = {
    Channel: [
        {
            name: 'onebridgeEnabled',
            type: 'boolean',
            defaultValue: false,
            label: [zh('启用 ONE BRIDGE 跨境能力'), ko('ONE BRIDGE 크로스보더 사용')],
        },
        {
            name: 'onebridgeServiceChannels',
            type: 'struct',
            list: true,
            nullable: true,
            public: true,
            label: [zh('业务频道配置'), ko('비즈니스 채널 설정')],
            fields: [
                { name: 'needType', type: 'string' },
                { name: 'nameKr', type: 'string' },
                { name: 'nameCn', type: 'string' },
                { name: 'nameEn', type: 'string' },
                { name: 'tag', type: 'string' },
                { name: 'audience', type: 'string' },
                { name: 'headlineKr', type: 'string' },
                { name: 'headlineCn', type: 'string' },
                { name: 'introKr', type: 'text' },
                { name: 'introCn', type: 'text' },
                { name: 'color', type: 'string' },
                // struct 字段不支持嵌套 struct，points 以 JSON 文本存放（结构见文档 CT-03 points[]）
                { name: 'pointsJson', type: 'text' },
            ],
        },
        {
            name: 'onebridgeContactChannel',
            type: 'struct',
            nullable: true,
            public: true,
            label: [zh('联系方式'), ko('연락 채널')],
            fields: [
                { name: 'kakao', type: 'string' },
                { name: 'wechat', type: 'string' },
                { name: 'phone', type: 'string' },
                { name: 'email', type: 'string' },
            ],
        },
    ],
};
