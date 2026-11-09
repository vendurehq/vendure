"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zh = exports.ko = void 0;
exports.stageLabel = stageLabel;
exports.customsStatusLabel = customsStatusLabel;
exports.timelineCopy = timelineCopy;
exports.logisticsSteps = logisticsSteps;
exports.timelineNodeCopy = timelineNodeCopy;
exports.localePack = localePack;
const ko_1 = require("./ko");
Object.defineProperty(exports, "ko", { enumerable: true, get: function () { return ko_1.ko; } });
const zh_1 = require("./zh");
Object.defineProperty(exports, "zh", { enumerable: true, get: function () { return zh_1.zh; } });
function pick(candidate, fallback) {
    return candidate && candidate.trim() ? candidate : fallback;
}
/** 阶段标签：韩文缺失时回落中文，禁止在代码里自造韩文 */
function stageLabel(stage, locale = 'zh') {
    return locale === 'ko' ? pick(ko_1.ko.stage[stage], zh_1.zh.stage[stage]) : zh_1.zh.stage[stage];
}
/** 清关子状态标签（CT-06 六态） */
function customsStatusLabel(status, locale = 'zh') {
    return locale === 'ko' ? pick(ko_1.ko.customsStatus[status], zh_1.zh.customsStatus[status]) : zh_1.zh.customsStatus[status];
}
/** 时间轴节点文案（按业务线），韩文缺失逐字段回落中文 */
function timelineCopy(line, locale = 'zh') {
    return zh_1.zh.timeline[line].map((fallback, index) => {
        const koCopy = ko_1.ko.timeline[line][index];
        if (locale !== 'ko' || !koCopy)
            return Object.assign({}, fallback);
        return {
            title: pick(koCopy.title, fallback.title),
            desc: pick(koCopy.desc, fallback.desc),
        };
    });
}
/** 物流 5 节点文案（options/data.js logistics.steps） */
function logisticsSteps(locale = 'zh') {
    return zh_1.zh.logistics.steps.map((fallback, index) => {
        const koStep = ko_1.ko.logistics.steps[index];
        return locale === 'ko' ? pick(koStep, fallback) : fallback;
    });
}
/** 某条时间轴上第 index 个节点的文案（支付完成节点即 net[1]） */
function timelineNodeCopy(line, index, locale = 'zh') {
    var _a;
    const nodes = timelineCopy(line, locale);
    return (_a = nodes[index]) !== null && _a !== void 0 ? _a : { title: '', desc: '' };
}
function localePack(locale) {
    return locale === 'ko' ? ko_1.ko : zh_1.zh;
}
//# sourceMappingURL=index.js.map