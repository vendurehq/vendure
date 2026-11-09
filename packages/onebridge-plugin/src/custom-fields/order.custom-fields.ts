import { CustomFields, LanguageCode } from '@vendure/core';

const zh = (value: string) => ({ languageCode: LanguageCode.zh_Hans, value });
const ko = (value: string) => ({ languageCode: LanguageCode.ko, value });

/** 订单侧跨境字段（CT-04）：业务阶段独立存 customField，不塞进 OrderState */
export const onebridgeOrderCustomFields: CustomFields = {
    Order: [
        {
            name: 'businessLine',
            type: 'string',
            nullable: true,
            public: true,
            label: [zh('运营业务线'), ko('운영 사업 라인')],
            options: [
                { value: 'net', label: [zh('撒网·小商品 B2C'), ko('넷·소상품 B2C')] },
                { value: 'pond', label: [zh('养鱼·垂直专栏'), ko('폰드·버티컬 칼럼')] },
                { value: 'hook', label: [zh('钓鱼·B2B 项目制'), ko('훅·B2B 프로젝트')] },
            ],
        },
        {
            name: 'crossBorderStage',
            type: 'string',
            nullable: true,
            public: true,
            label: [zh('跨境业务阶段（CrossBorderStage）'), ko('국경 간 업무 단계')],
        },
        {
            name: 'rfqCode',
            type: 'string',
            nullable: true,
            public: true,
            label: [zh('关联 RFQ 受理编号'), ko('연결 RFQ 접수 번호')],
        },
        {
            name: 'needType',
            type: 'string',
            nullable: true,
            public: true,
            label: [zh('前台模块'), ko('프론트 모듈')],
            options: [
                { value: 'logistics', label: [zh('物流通道'), ko('물류 채널')] },
                { value: 'daily', label: [zh('日用精选'), ko('데일리')] },
                { value: 'collections', label: [zh('精选专栏'), ko('컬렉션')] },
                { value: 'projects', label: [zh('项目定制'), ko('프로젝트')] },
            ],
        },
        {
            name: 'krwAmount',
            type: 'int',
            nullable: true,
            public: true,
            label: [zh('KRW 金额（最小单位）'), ko('KRW 금액(최소 단위)')],
        },
        {
            name: 'cnPurchaseOrderNo',
            type: 'string',
            nullable: true,
            public: false,
            label: [zh('中国采购单号'), ko('중국 구매 주문 번호')],
        },
        {
            name: 'expectedEta',
            type: 'datetime',
            nullable: true,
            public: true,
            label: [zh('预计交付时间'), ko('예상 납기')],
        },
    ],
};
