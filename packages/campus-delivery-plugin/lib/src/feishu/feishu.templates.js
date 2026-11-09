"use strict";
/** 飞书消息文案（纯函数，便于单测；不含 emoji，保持运维群阅读清爽） */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPLY_TEMPLATES = exports.HELP_TEXT = void 0;
exports.formatPush = formatPush;
exports.formatDateTime = formatDateTime;
exports.formatBoard = formatBoard;
exports.formatDigest = formatDigest;
exports.formatPlatformBoard = formatPlatformBoard;
exports.formatExceptions = formatExceptions;
exports.formatPlatformDigest = formatPlatformDigest;
exports.orderHallLabel = orderHallLabel;
exports.orderDeliveryLabel = orderDeliveryLabel;
exports.formatOrderStatus = formatOrderStatus;
exports.shortCode = shortCode;
exports.buildRiderGrabCard = buildRiderGrabCard;
exports.buildOrderCard = buildOrderCard;
exports.buildSearchCard = buildSearchCard;
exports.matchReplyTemplate = matchReplyTemplate;
exports.replyTemplateText = replyTemplateText;
exports.buildTemplateCard = buildTemplateCard;
exports.extractOrderCodeFromCard = extractOrderCodeFromCard;
exports.extractOrderCodeFromText = extractOrderCodeFromText;
const SCENE_LABEL = {
    shop_new_order: '新订单',
    after_sales: '售后',
    exception: '异常/超时',
    payment_timeout: '支付超时',
    digest: '每日汇总',
    support_ticket: '客服工单',
    rider_appeal: '骑手申诉',
    blacklist_auto: '黑名单自动规则',
};
function formatPush(input) {
    var _a;
    const label = (_a = SCENE_LABEL[input.scene]) !== null && _a !== void 0 ? _a : input.scene;
    const lines = [`【${label}】${input.title}`];
    if (input.orderCode)
        lines.push(`订单：${input.orderCode}`);
    if (input.content)
        lines.push(input.content);
    if (input.at)
        lines.push(`时间：${formatDateTime(input.at)}`);
    if (input.link)
        lines.push(`详情：${input.link}`);
    return lines.join('\n');
}
function formatDateTime(at) {
    const d = new Date(at + 8 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
exports.HELP_TEXT = [
    '📋 群指令：',
    '  待处理 / 看板 — 各环节订单数量（管理群为跨店视图）',
    '  查 <尾号/楼栋> — 模糊检索，返回候选卡片',
    '  异常 — 异常未处置 + 已超时 + 即将超时 ⚠️ 三段清单',
    '  今日汇总 — 立即返回当天经营数据（管理群为全平台）',
    '  接单 <尾号> / 出餐 <尾号> — 也可直接点卡片按钮',
    '  送达 <尾号> — 商户/自营快递已送到校园交接点',
    '  重发交接码 <尾号> — 交接码过期/遗失时重新生成（10 分钟一次）',
    '  拒单 <单号> <原因> — 需再次「确认拒单 <单号>」（店主）',
    '  恢复 <单号> — 恢复进调度队；需再次「确认恢复 <单号>」',
    '  关店 <店铺> / 开店 <店铺> — 暂停/恢复接单（店主）',
    '',
    '🃏 异常卡按钮：改派 → 已处置 → 退差价 → 发券 → 全额退款',
    '💓 每整点发服务健康心跳；异常单会把告警合并进同一张卡片',
    '',
    '引用订单卡片回复「催单 / 联系骑手 / 已联系顾客」— 自动归入本订单话题',
    '帮助 — 显示本清单',
].join('\n');
function formatBoard(board) {
    var _a, _b, _c, _d, _e, _f;
    const codes = (list) => (list !== null && list !== void 0 ? list : []).slice(0, 5).map(o => o.code).filter(Boolean).join('、');
    const lines = [`【${board.storeName || '店铺'}】营业状态：${board.paused ? '已暂停' : '营业中'}`];
    lines.push(`待接单 ${board.pending.length}${codes(board.pending) ? `（${codes(board.pending)}）` : ''}`);
    lines.push(`备餐中 ${board.cooking.length}`);
    lines.push(`待取货 ${board.awaitingRider.length}`);
    lines.push(`配送中 ${board.delivering.length}`);
    if (((_b = (_a = board.pendingDispatch) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0)
        lines.push(`待推外部 ${(_c = board.pendingDispatch) === null || _c === void 0 ? void 0 : _c.length}`);
    if (((_e = (_d = board.thirdParty) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0) > 0)
        lines.push(`外部配送 ${(_f = board.thirdParty) === null || _f === void 0 ? void 0 : _f.length}`);
    lines.push(`今日已完成 ${board.completedToday} 单，金额 ¥${(board.completedTodayAmount / 100).toFixed(2)}`);
    return lines.join('\n');
}
function formatDigest(d) {
    const lines = [`【每日汇总】${d.date} ${d.storeName || ''}`.trim()];
    lines.push(`订单量 ${d.totalOrders}（取消 ${d.cancelled}）`);
    lines.push(`完成 ${d.completedToday} 单，金额 ¥${(d.completedTodayAmount / 100).toFixed(2)}`);
    lines.push(`准点率 ${d.onTimeRate}%`);
    lines.push(`当前待接单 ${d.pending.length}、备餐中 ${d.cooking.length}、配送中 ${d.delivering.length}`);
    lines.push(`异常未处置 ${d.exceptionCount}`);
    lines.push(`营业状态：${d.paused ? '已暂停' : '营业中'}`);
    return lines.join('\n');
}
function activeCount(s) {
    return s.pending + s.cooking + s.awaitingRider + s.delivering + s.pendingDispatch
        + s.thirdParty + s.ownedPool + s.ownedDispatched + s.merchantDelivering;
}
function formatPlatformBoard(input) {
    const { stores } = input;
    const lines = [`【跨店看板】${formatDateTime(input.at)}`];
    for (const s of stores) {
        const codes = s.pendingCodes.length ? `（${s.pendingCodes.join('、')}）` : '';
        lines.push(`· ${s.name} ${s.paused ? '已暂停' : '营业中'}｜待接单 ${s.pending}${codes}`
            + `｜备餐 ${s.cooking}｜待取 ${s.awaitingRider}｜配送 ${s.delivering}`
            + `｜待推外部 ${s.pendingDispatch}｜外部 ${s.thirdParty}`
            + `｜自营池 ${s.ownedPool}｜自营送 ${s.ownedDispatched}｜商户送 ${s.merchantDelivering}`
            + `｜异常 ${s.exceptionCount}`);
    }
    const active = stores.reduce((n, s) => n + activeCount(s), 0);
    const done = stores.reduce((n, s) => n + s.completedToday, 0);
    const amount = stores.reduce((n, s) => n + s.completedTodayAmount, 0);
    lines.push(`合计：进行中 ${active} 单｜今日完成 ${done} 单 ¥${(amount / 100).toFixed(2)}`);
    if (input.exceptions.length) {
        lines.push(`【异常未处置 ${input.exceptions.length}】`);
        lines.push(...input.exceptions.slice(0, 8).map(t => `· ${t}`));
    }
    if (input.overdue.length) {
        lines.push(`【超时风险 ${input.overdue.length}】`);
        lines.push(...input.overdue.slice(0, 8).map(t => `· ${t}`));
    }
    return lines.join('\n');
}
function groupByStore(lines) {
    const groups = {};
    for (const l of lines) {
        const parts = l.split(/\s+/);
        const store = parts.length >= 2 ? parts[1] : '未知';
        (groups[store] || (groups[store] = [])).push(l);
    }
    return groups;
}
function formatSection(title, lines, max = 15) {
    if (!lines.length)
        return [];
    const trimmed = lines.slice(0, max);
    const groups = groupByStore(trimmed);
    const out = [`【${title} ${lines.length}】`];
    const storeNames = Object.keys(groups).sort();
    for (const store of storeNames) {
        const items = groups[store];
        out.push(`  ${store}（${items.length}）`);
        for (const it of items)
            out.push(`    · ${it}`);
    }
    if (lines.length > max)
        out.push(`  ... 其余 ${lines.length - max} 条`);
    return out;
}
function formatExceptions(exceptions, overdue, soonOverdue = []) {
    if (!exceptions.length && !overdue.length && !soonOverdue.length)
        return '当前没有异常或超时订单。';
    const lines = [];
    lines.push(...formatSection('异常未处置', exceptions));
    lines.push(...formatSection('已超时', overdue));
    lines.push(...formatSection('即将超时 ⚠️', soonOverdue));
    return lines.join('\n');
}
function formatPlatformDigest(input) {
    const lines = [`【每日汇总】${input.date} 全平台`];
    for (const s of input.stores) {
        lines.push(`· ${s.name} 完成 ${s.completed} 单 ¥${(s.amount / 100).toFixed(2)}`
            + `｜准点率 ${s.onTimeRate}%｜取消 ${s.cancelled}｜异常 ${s.exception}`);
    }
    lines.push(`合计：订单 ${input.totalOrders}（取消 ${input.cancelled}）`
        + `、完成 ${input.completed} 单 ¥${(input.amount / 100).toFixed(2)}`
        + `、准点率 ${input.onTimeRate}%、异常未处置 ${input.exception}`);
    return lines.join('\n');
}
const HALL_LABEL = {
    scheduled: '预约待放量',
    pending_merchant: '待商户接单',
    accepted: '备餐中',
    open: '待抢单',
    grabbed: '骑手已接单',
    pending_dispatch: '待推外部快递',
    third_party: '外部快递配送中',
    owned_pool: '待自营接单',
    owned_dispatched: '自营配送中',
    merchant_delivering: '商户送往交接点',
    exception: '异常待处置',
};
const DELIVERY_LABEL = {
    assigned: '已派单未取货',
    picked: '已取货',
    delivering: '配送中',
    delivered: '已送达',
    exception: '异常',
};
function orderHallLabel(status) {
    var _a;
    return status ? (_a = HALL_LABEL[status]) !== null && _a !== void 0 ? _a : status : '未进入配送流程';
}
function orderDeliveryLabel(status) {
    var _a;
    return status ? (_a = DELIVERY_LABEL[status]) !== null && _a !== void 0 ? _a : status : null;
}
function formatOrderStatus(o) {
    var _a, _b;
    const hall = o.hallStatus ? (_a = HALL_LABEL[o.hallStatus]) !== null && _a !== void 0 ? _a : o.hallStatus : '未进入配送流程';
    const delivery = o.deliveryStatus ? (_b = DELIVERY_LABEL[o.deliveryStatus]) !== null && _b !== void 0 ? _b : o.deliveryStatus : null;
    const lines = [`【订单 ${o.code}】${o.store}`];
    lines.push(`订单状态：${o.orderState}｜配送环节：${hall}${delivery ? `（${delivery}）` : ''}`);
    if (o.route)
        lines.push(`配送路线：${o.route}${o.riderName ? `｜骑手：${o.riderName}` : ''}`);
    else if (o.riderName)
        lines.push(`骑手：${o.riderName}`);
    const addr = [o.building, o.zone, o.slotText].filter(Boolean).join(' ');
    if (addr)
        lines.push(`送达信息：${addr}`);
    if (typeof o.total === 'number')
        lines.push(`订单金额：¥${(o.total / 100).toFixed(2)}`);
    if (o.exceptionType || o.exceptionNote) {
        const mins = o.exceptionMinutes != null ? `（已上报 ${o.exceptionMinutes} 分钟）` : '';
        lines.push(`异常：${[o.exceptionType, o.exceptionNote].filter(Boolean).join('｜')}${mins}`);
    }
    lines.push(`下单时间：${formatDateTime(o.createdAt)}｜已过 ${Math.max(0, Math.round((o.at - o.createdAt) / 60000))} 分钟`);
    return lines.join('\n');
}
// ---------- 交互卡片（零建表：短码只在展示层计算，完整单号只放在按钮 value 里） ----------
/** 展示用短码：去掉非字母数字后取尾 4 位；完整单号始终在按钮 value / 引用回读中 */
function shortCode(code) {
    const clean = (code !== null && code !== void 0 ? code : '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return clean.length <= 4 ? clean : clean.slice(-4);
}
function cardButton(text, value, type = 'default') {
    return { tag: 'button', text: { tag: 'plain_text', content: text }, type, value };
}
function cardNote(content) {
    return { tag: 'note', elements: [{ tag: 'plain_text', content }] };
}
/** 骑手抢单卡片：标题「新单待抢」+ 取送点/金额/剩余时限 + 单个「抢单」按钮（value 走 rider_grab 回调） */
function buildRiderGrabCard(o) {
    var _a;
    const short = shortCode(o.code);
    const mins = Math.max(0, Math.round(o.remainingMinutes));
    const amount = `¥${(((_a = o.total) !== null && _a !== void 0 ? _a : 0) / 100).toFixed(2)}`;
    return {
        config: { wide_screen_mode: true },
        header: {
            template: 'orange',
            title: { tag: 'plain_text', content: `🛵 新单待抢 · ${short}` },
        },
        elements: [
            {
                tag: 'div',
                text: {
                    tag: 'lark_md',
                    content: `📍 **取送点**：${o.addr}\n💰 **金额**：${amount}\n⏱ **剩余时限**：${mins} 分钟`,
                },
            },
            {
                tag: 'action',
                actions: [
                    cardButton('抢单', { a: 'rider_grab', c: o.code, o: String(o.orderId) }, 'primary'),
                ],
            },
            cardNote('点击「抢单」即占用该单；需已绑定骑手身份，权限由系统校验'),
        ],
    };
}
function buildOrderCard(o) {
    var _a, _b, _c;
    const short = shortCode(o.code);
    const hall = orderHallLabel(o.hallStatus);
    const delivery = orderDeliveryLabel(o.deliveryStatus);
    const exception = o.deliveryStatus === 'exception' || o.hallStatus === 'exception';
    const mins = Math.max(0, Math.round((o.at - o.createdAt) / 60000));
    const template = exception
        ? 'red'
        : o.hallStatus === 'pending_merchant'
            ? 'orange'
            : o.hallStatus === 'accepted'
                ? 'blue'
                : o.hallStatus
                    ? 'turquoise'
                    : 'grey';
    // 头部主状态最显眼：emoji + 中文状态 + 短码，一眼看清卡要干啥
    const emoji = exception ? '⚠️'
        : o.hallStatus === 'pending_merchant' ? '🟠'
            : o.hallStatus === 'accepted' ? '🔵'
                : o.hallStatus === 'open' ? '🟢'
                    : o.hallStatus ? '🔷'
                        : '⚪';
    const headerTitle = `${emoji} ${(_a = hall !== null && hall !== void 0 ? hall : o.hallStatus) !== null && _a !== void 0 ? _a : '未入厅'} · ${short}`;
    const addr = [o.building, o.zone, o.slotText].filter(Boolean).join(' ') || '-';
    const rider = o.riderName ? `🏍 ${o.riderName}` : '';
    const route = o.route ? `📦 ${o.route}` : '';
    const amount = `¥${(((_b = o.total) !== null && _b !== void 0 ? _b : 0) / 100).toFixed(2)}`;
    // 主信息块合并：一行关键数据，不用 2×2 fields 网格（用户说乱）
    const mainDiv = [
        `📍 **${addr}**`,
        route,
        rider,
        `⏱ 已过 ${mins} 分钟 · 💰 ${amount}`,
    ].filter(Boolean).join(' ｜ ');
    const elements = [
        { tag: 'div', text: { tag: 'lark_md', content: mainDiv } },
    ];
    // P2.1 同单告警合并：由 FeishuCardService 传入，每次 buildCard 重建时都会带上
    // 这样卡片被按钮 handler 刷新（refresh/updateCard）时不会丢失之前 appendAlert 追加的告警行
    if ((_c = o.alerts) === null || _c === void 0 ? void 0 : _c.length) {
        for (const alert of o.alerts) {
            elements.push({ tag: 'div', text: { tag: 'lark_md', content: `🚨 **${alert}**` } });
        }
    }
    // 异常单独一行（红色 header 已经显眼，这里只给处置线索）
    if (exception) {
        const reported = o.exceptionMinutes != null ? `（已上报 ${o.exceptionMinutes} 分钟）` : '';
        const detail = [o.exceptionType, o.exceptionNote].filter(Boolean).join('｜') || '异常未处置';
        elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**⚠️ 异常**：${detail}${reported}` } });
    }
    // 按钮：状态相关的 primary 放最左，其余次级按使用频率排
    const actions = [];
    if (exception) {
        actions.push(cardButton('改派', { a: 'reassign', c: o.code }, 'primary'));
        actions.push(cardButton('已处置', { a: 'handled', c: o.code }));
        actions.push(cardButton('退差价', { a: 'refund_diff', c: o.code }));
        actions.push(cardButton('发券', { a: 'coupon', c: o.code }));
        actions.push(cardButton('全额退款', { a: 'refund_all', c: o.code }, 'danger'));
    }
    else {
        if (o.hallStatus === 'pending_merchant')
            actions.push(cardButton('接单', { a: 'accept', c: o.code }, 'primary'));
        if (o.hallStatus === 'accepted')
            actions.push(cardButton('出餐', { a: 'cooking', c: o.code }, 'primary'));
    }
    actions.push(cardButton('状态', { a: 'status', c: o.code }));
    actions.push(cardButton('快捷回复', { a: 'template', c: o.code }));
    elements.push({ tag: 'action', actions });
    elements.push(cardNote(`短码 ${short} · ${o.store} · 引用本卡回复自动归入本订单`));
    return {
        config: { wide_screen_mode: true, update_multi: true },
        header: { template, title: { tag: 'plain_text', content: headerTitle } },
        elements,
    };
}
/** 模糊检索结果卡片：每行一个候选订单，按钮 value 里带完整单号 */
function buildSearchCard(query, rows) {
    const elements = [];
    if (!rows.length) {
        elements.push({ tag: 'div', text: { tag: 'lark_md', content: `没有匹配「${query}」的订单。` } });
    }
    for (const r of rows.slice(0, 4)) {
        const detail = [orderHallLabel(r.hallStatus), r.building, r.store, formatDateTime(r.createdAt)]
            .filter(Boolean)
            .join(' · ');
        elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${shortCode(r.code)}**\n${detail}` } });
        const actions = [cardButton('查看', { a: 'status', c: r.code })];
        if (r.hallStatus === 'pending_merchant')
            actions.push(cardButton('接单', { a: 'accept', c: r.code }, 'primary'));
        if (r.hallStatus === 'accepted')
            actions.push(cardButton('出餐', { a: 'cooking', c: r.code }, 'primary'));
        elements.push({ tag: 'action', actions });
    }
    elements.push(cardNote('回复「查 <完整单号>」可精确检索；点按钮直接操作该订单'));
    return {
        config: { wide_screen_mode: true, update_multi: true },
        header: { template: 'blue', title: { tag: 'plain_text', content: `检索「${query}」· ${rows.length} 条` } },
        elements,
    };
}
exports.REPLY_TEMPLATES = [
    {
        id: 'urge_accept',
        label: '催接单',
        aliases: ['催单', '催接单', '催商家接单'],
        text: '【催单】订单 {code} 已等待较久，请尽快接单，谢谢。',
    },
    {
        id: 'urge_cooking',
        label: '催出餐',
        aliases: ['催出餐', '催餐'],
        text: '【催出餐】订单 {code} 顾客在等，请尽快出餐并交接骑手。',
    },
    {
        id: 'contact_rider',
        label: '联系骑手',
        aliases: ['联系骑手', '骑手'],
        text: '【联系骑手】订单 {code} 请骑手确认取货进度，并回复预计送达时间。',
    },
    {
        id: 'address_change',
        label: '顾客改址',
        aliases: ['改址', '顾客改址'],
        text: '【顾客改址】订单 {code} 顾客申请修改送达楼栋，请确认后按新地址配送。',
    },
    {
        id: 'out_of_stock',
        label: '缺货处理',
        aliases: ['缺货', '缺货处理'],
        text: '【缺货】订单 {code} 部分商品缺货，请尽快电话联系顾客确认替换或退款。',
    },
    {
        id: 'refund_note',
        label: '退款说明',
        aliases: ['退款说明', '退款'],
        text: '【退款说明】订单 {code} 已按顾客要求发起退款，请留意到账通知。',
    },
    {
        id: 'contacted_customer',
        label: '已联系顾客',
        aliases: ['已联系顾客', '已联系'],
        text: '【已联系顾客】订单 {code} 已与顾客沟通并确认处理方式。',
    },
    {
        id: 'later',
        label: '稍后处理',
        aliases: ['稍后处理', '稍后'],
        text: '【稍后处理】订单 {code} 已收到，预计稍后处理，请勿重复催单。',
    },
    {
        id: 'escalate',
        label: '转客服',
        aliases: ['转客服', '客服'],
        text: '【转客服】订单 {code} 情况复杂，已转平台客服跟进。',
    },
    {
        id: 'resolved',
        label: '已解决',
        aliases: ['已解决', '解决'],
        text: '【已解决】订单 {code} 问题已处理完毕。',
    },
];
function normalizeText(raw) {
    return (raw !== null && raw !== void 0 ? raw : '')
        .replace(/@_user_\d+/g, ' ')
        .replace(/@\S+\s*/g, ' ')
        .replace(/[\s，。！!？?、：:；;]/g, '')
        .trim();
}
/** 引用订单卡片时，整段文本命中模板名/别名则视为快捷回复 */
function matchReplyTemplate(raw) {
    const text = normalizeText(raw);
    if (!text)
        return undefined;
    return exports.REPLY_TEMPLATES.find(t => [t.label, ...t.aliases].some(name => normalizeText(name) === text));
}
function replyTemplateText(tpl, code) {
    return tpl.text.replace(/\{code\}/g, code);
}
/** 快捷回复卡片：按钮 value 带完整单号与模板 id */
function buildTemplateCard(code) {
    const buttons = exports.REPLY_TEMPLATES.map(t => cardButton(t.label, { a: 'tpl', c: code, t: t.id }));
    const groups = [];
    for (let i = 0; i < buttons.length; i += 5) {
        groups.push({ tag: 'action', actions: buttons.slice(i, i + 5) });
    }
    return {
        config: { wide_screen_mode: true, update_multi: true },
        header: { template: 'grey', title: { tag: 'plain_text', content: `快捷回复 · ${shortCode(code)}` } },
        elements: [
            { tag: 'div', text: { tag: 'lark_md', content: '点击下方按钮，模板会直接回复到本订单话题。' } },
            ...groups,
            cardNote(`短码 ${shortCode(code)} · 也可引用订单卡片回复「催单 / 联系骑手 / 已联系顾客」`),
        ],
    };
}
/** 从卡片 JSON（按钮 value）里取完整单号 */
function extractOrderCodeFromCard(content) {
    if (!content)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (_a) {
        return undefined;
    }
    const seen = new Set();
    const walk = (node, depth) => {
        if (!node || depth > 10 || typeof node !== 'object' || seen.has(node))
            return undefined;
        seen.add(node);
        if (typeof node.c === 'string' && typeof node.a === 'string')
            return node.c;
        const values = Array.isArray(node) ? node : Object.values(node);
        for (const v of values) {
            const hit = walk(v, depth + 1);
            if (hit)
                return hit;
        }
        return undefined;
    };
    return walk(parsed, 0);
}
/** 从被引用的纯文本消息里兜底提取单号（形如「订单 A1234…」） */
function extractOrderCodeFromText(text) {
    var _a;
    if (!text)
        return undefined;
    const tokens = (_a = text.match(/[0-9A-Za-z]{6,}/g)) !== null && _a !== void 0 ? _a : [];
    return tokens.sort((a, b) => b.length - a.length)[0];
}
//# sourceMappingURL=feishu.templates.js.map