"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onebridgeProductCustomFields = void 0;
const core_1 = require("@vendure/core");
const zh = (value) => ({ languageCode: core_1.LanguageCode.zh_Hans, value });
const ko = (value) => ({ languageCode: core_1.LanguageCode.ko, value });
/** 商品与规格货品（CT-03）：跨境商品最小字段集 */
exports.onebridgeProductCustomFields = {
    Product: [
        { name: 'krName', type: 'string', nullable: true, public: true, label: [zh('韩文商品名'), ko('한국어 상품명')] },
        { name: 'cnName', type: 'string', nullable: true, public: true, label: [zh('中文商品名'), ko('중국어 상품명')] },
        { name: 'spec', type: 'string', nullable: true, public: true, label: [zh('规格'), ko('규격')] },
        { name: 'moq', type: 'int', nullable: true, public: true, label: [zh('起订量 MOQ'), ko('최소 주문량 MOQ')] },
        { name: 'leadTime', type: 'string', nullable: true, public: true, label: [zh('交付周期'), ko('납기')] },
        {
            name: 'inspectionRequired',
            type: 'boolean',
            defaultValue: false,
            public: true,
            label: [zh('需出货前验货'), ko('출하 전 검품 필요')],
        },
        {
            name: 'originalPrice',
            type: 'int',
            nullable: true,
            public: true,
            label: [zh('原价（最小单位）'), ko('원가(최소 단위)')],
        },
        { name: 'badge', type: 'string', nullable: true, public: true, label: [zh('角标文案'), ko('뱃지 문구')] },
    ],
    ProductVariant: [
        { name: 'accuracy', type: 'string', nullable: true, public: true, label: [zh('精度'), ko('정밀도')] },
        { name: 'material', type: 'string', nullable: true, public: true, label: [zh('材质'), ko('소재')] },
        { name: 'moq', type: 'int', nullable: true, public: true, label: [zh('起订量 MOQ'), ko('최소 주문량 MOQ')] },
        { name: 'leadTime', type: 'string', nullable: true, public: true, label: [zh('交付周期'), ko('납기')] },
        {
            name: 'reportTemplate',
            type: 'string',
            nullable: true,
            public: true,
            label: [zh('验货报告模板'), ko('검품 리포트 템플릿')],
        },
    ],
};
//# sourceMappingURL=product.custom-fields.js.map