"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zh = void 0;
/**
 * 中文文案（权威释义）：14 态取自 demo/data.js STATUS，
 * 三条时间轴取自 demo/data.js STAGES + buildTimeline 的 desc，
 * 物流 5 节点取 options/data.js logistics.steps。
 */
exports.zh = {
    stage: {
        lost: '已关闭',
        wait_pay: '待付款',
        quoting: '询价中',
        requirement: '需求确认',
        sourcing: '工厂匹配',
        risk: '风控复核',
        sample: '样品确认',
        producing: '排产中',
        shipping: '运输中',
        qc: '验货中',
        refund: '售后处理',
        delivered: '已交付',
        customs: '清关交付',
        done: '已完成',
    },
    customsStatus: {
        not_started: '未开始',
        docs_preparing: '资料准备',
        declared: '已申报',
        inspecting: '查验中',
        cleared: '已放行',
        hold: '暂扣',
    },
    timeline: {
        net: [
            { title: '订单创建', desc: '客户在网站提交订单' },
            { title: '支付完成', desc: '支付网关确认完成' },
            { title: '中国平台采购', desc: '拼多多/工厂当日下单' },
            { title: '威海仓出库', desc: '威海仓合包称重' },
            { title: '中韩运输', desc: '中韩干线在途' },
            { title: '清关派送', desc: '仁川通关并交派送' },
            { title: '签收完成', desc: '收件人签收' },
        ],
        pond: [
            { title: '询盘登记', desc: '客户提交品名与规格' },
            { title: '规格确认', desc: '精度、材质与 MOQ 对齐' },
            { title: '报价与样品', desc: '工厂报价并寄送样品' },
            { title: '工厂备货', desc: '按确认样品备货' },
            { title: '出货前验货', desc: '出货前逐件检验并出报告' },
            { title: '交付与回访', desc: '交付并安排回访' },
        ],
        hook: [
            { title: '需求与规格确认', desc: '需求、图纸与验收标准书面确认' },
            { title: '工厂匹配/比价', desc: '多家工厂比价与资质核查' },
            { title: '合同与定金', desc: '合同条款与分阶段付款' },
            { title: '排产跟进', desc: '排产节点周报同步' },
            { title: '出货前验货', desc: '第三方/自检报告放行' },
            { title: '装箱/清关', desc: '装箱、单证与清关' },
            { title: '现场交付', desc: '韩国现场交付与结案' },
        ],
    },
    logistics: {
        steps: ['告诉我们需求', '确认运输方案', '收货 · 验货 · 合包', '通关与干线运输', '韩国派送与售后'],
    },
};
//# sourceMappingURL=zh.js.map