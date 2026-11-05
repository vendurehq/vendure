"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = exports.CHAT_STATUSES = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const chat_entities_1 = require("./chat.entities");
const typeorm_1 = require("typeorm");
const feishu_notify_service_1 = require("./feishu/feishu-notify.service");
const privacy_number_service_1 = require("./privacy-number.service");
const loggerCtx = 'CampusChat';
exports.CHAT_STATUSES = ['open', 'closed'];
const MAX_CONTENT = 500;
const MAX_IMAGES = 6;
const MAX_TAKE = 100;
function clampSkip(v) {
    return Math.max(0, Number(v !== null && v !== void 0 ? v : 0) || 0);
}
function clampTake(v, fallback = 50) {
    const n = Number(v !== null && v !== void 0 ? v : fallback) || fallback;
    return Math.min(Math.max(n, 1), MAX_TAKE);
}
function normalizeImages(images) {
    const list = (images !== null && images !== void 0 ? images : []).map(v => String(v !== null && v !== void 0 ? v : '').trim()).filter(Boolean);
    if (list.length > MAX_IMAGES)
        throw new core_1.UserInputError(`最多上传 ${MAX_IMAGES} 张图片`);
    return list;
}
/** 列表页摘要：去掉换行并截断，避免超长文本撑破 layout */
function brief(text) {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}
function messageBrief(content, images) {
    if (content)
        return brief(content);
    if (images === null || images === void 0 ? void 0 : images.length)
        return `[图片${images.length > 1 ? ` ×${images.length}` : ''}]`;
    return '';
}
/**
 * 在线客服 IM（P0-3）：C 端顾客与后台运营/商家的一对多会话（按订单归集）。
 * C 端（shop-api）只能操作本人的会话；后台（admin-api）按当前渠道隔离。
 * 轮询模型：C 端 5s 拉增量消息（afterId），无长连接/推送，部署形态与其它 job 一致。
 */
let ChatService = class ChatService {
    constructor(connection, customerService, feishu, 
    /** 号码保护（H2）：可选注入；缺失时（单测/独立装配）退回原文，不影响会话主流程 */
    privacy) {
        this.connection = connection;
        this.customerService = customerService;
        this.feishu = feishu;
        this.privacy = privacy;
    }
    /** 展示号转换器：启用号码保护时脱敏，未启用/依赖缺失时退回原文 */
    async phoneDisplayer(ctx) {
        if (this.privacy)
            return this.privacy.displayer(ctx, ctx.channelId);
        return p => {
            const raw = String(p !== null && p !== void 0 ? p : '').trim();
            return raw || null;
        };
    }
    async requireCustomer(ctx) {
        if (!ctx.activeUserId)
            throw new core_1.ForbiddenError();
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer)
            throw new core_1.ForbiddenError();
        return customer;
    }
    /** 飞书提醒：仅记录日志、绝不阻塞会话（未启用时 pushEvent 直接返回 true） */
    async pushFeishu(ctx, title, content, orderCode, dedupeKey) {
        var _a, _b;
        try {
            await this.feishu.pushEvent('chat_message', title, content, orderCode !== null && orderCode !== void 0 ? orderCode : undefined, dedupeKey, {
                channel: (_a = ctx.channel) === null || _a === void 0 ? void 0 : _a.code,
            });
        }
        catch (e) {
            core_1.Logger.warn(`飞书提醒失败 scene=chat_message: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, loggerCtx);
        }
    }
    /** 顾客侧会话归属校验：非本人会话一律当作不存在（防越权读他人会话） */
    async requireOwnConversation(ctx, customerId, conversationId) {
        const conversation = await this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).findOne({
            where: { id: conversationId, customerId: customerId, channelId: ctx.channelId },
        });
        if (!conversation)
            throw new core_1.UserInputError('会话不存在或不属于当前用户');
        return conversation;
    }
    // ---------------- 顾客侧 ----------------
    /**
     * 发起会话：同一顾客 + 同一订单（orderCode 均相同）已有 open 会话则复用，否则新建。
     * 订单详情「联系客服」与客服中心「在线咨询」都走这里，保证不产生重复会话。
     */
    async startConversation(ctx, orderCode, subject) {
        var _a, _b;
        const customer = await this.requireCustomer(ctx);
        const code = orderCode == null ? null : String(orderCode).trim() || null;
        // 订单号来自顾客入参：必须校验归属（本渠道 + 本人），否则可拿他人单号建会话并推送目标群
        if (code) {
            const order = await this.connection.getRepository(ctx, core_1.Order).findOne({
                where: { code },
                relations: ['customer', 'channels'],
            });
            const inChannel = (_a = order === null || order === void 0 ? void 0 : order.channels) === null || _a === void 0 ? void 0 : _a.some(c => Number(c.id) === Number(ctx.channelId));
            if (!order || !inChannel || Number((_b = order.customer) === null || _b === void 0 ? void 0 : _b.id) !== Number(customer.id)) {
                throw new core_1.UserInputError('订单不存在或不属于当前用户');
            }
        }
        const existing = await this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).findOne({
            where: {
                channelId: ctx.channelId,
                customerId: customer.id,
                status: 'open',
                orderCode: (code !== null && code !== void 0 ? code : null),
            },
            order: { id: 'DESC' },
        });
        if (existing)
            return existing;
        const title = subject == null ? null : String(subject).trim().slice(0, 60) || null;
        return this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).save({
            channelId: ctx.channelId,
            customerId: customer.id,
            orderCode: code,
            subject: title,
            status: 'open',
            lastMessage: null,
            lastMessageAt: null,
            lastSenderType: null,
            unreadForCustomer: 0,
            unreadForAdmin: 0,
            closedAt: null,
        });
    }
    async myConversations(ctx, skip, take) {
        const customer = await this.requireCustomer(ctx);
        return this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).find({
            where: { channelId: ctx.channelId, customerId: customer.id },
            order: { lastMessageAt: 'DESC' },
            skip: clampSkip(skip),
            take: clampTake(take, 20),
        });
    }
    /** 增量拉消息：afterId 之后的新消息（轮询用），缺省返回最近 N 条 */
    async messages(ctx, conversationId, afterId, take) {
        const customer = await this.requireCustomer(ctx);
        const conversation = await this.requireOwnConversation(ctx, customer.id, conversationId);
        const repo = this.connection.getRepository(ctx, chat_entities_1.CampusChatMessage);
        const limit = clampTake(take);
        const since = afterId == null || afterId === '' ? null : Number(afterId);
        const rows = await repo.find({
            where: Object.assign({ conversationId: conversation.id }, (since != null ? { id: (0, typeorm_1.MoreThan)(since) } : {})),
            order: { id: 'DESC' },
            take: limit,
        });
        return this.orderAsc(rows);
    }
    /** 顾客发消息：写消息 + 更新会话摘要/未读 + 首条消息推飞书提醒运营 */
    async sendMessage(ctx, conversationId, content, images) {
        var _a;
        const customer = await this.requireCustomer(ctx);
        const conversation = await this.requireOwnConversation(ctx, customer.id, conversationId);
        if (conversation.status === 'closed')
            throw new core_1.UserInputError('会话已结束，请重新发起咨询');
        const text = String(content !== null && content !== void 0 ? content : '').trim();
        const imgs = normalizeImages(images);
        if (!text && !imgs.length)
            throw new core_1.UserInputError('请填写消息内容');
        if (text.length > MAX_CONTENT)
            throw new core_1.UserInputError(`消息不能超过 ${MAX_CONTENT} 个字符`);
        const repo = this.connection.getRepository(ctx, chat_entities_1.CampusChatMessage);
        const message = await repo.save({
            conversationId: conversation.id,
            senderType: 'customer',
            senderId: Number(customer.id),
            content: text || null,
            images: imgs.length ? imgs : null,
            readAt: null,
        });
        const firstMessage = !conversation.lastMessageAt;
        await this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).update(conversation.id, {
            lastMessage: messageBrief(text || null, imgs),
            lastMessageAt: new Date(),
            lastSenderType: 'customer',
            unreadForAdmin: Number((_a = conversation.unreadForAdmin) !== null && _a !== void 0 ? _a : 0) + 1,
        });
        // 仅新会话的首条消息提醒（后续消息靠后台会话列表未读角标，避免刷屏）
        if (firstMessage) {
            const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || '-';
            // H2：飞书群消息长期留存，顾客号码按号码保护口径脱敏
            const display = await this.phoneDisplayer(ctx);
            const phoneText = display(customer.phoneNumber);
            void this.pushFeishu(ctx, '新客服咨询', [
                `顾客：${name}${phoneText ? `（${phoneText}）` : ''}`,
                conversation.orderCode ? `订单：${conversation.orderCode}` : '订单：未关联',
                `内容：${brief(text || messageBrief(null, imgs))}`,
            ].join('\n'), conversation.orderCode, `chat:${conversation.id}`);
        }
        return message;
    }
    /** 顾客已读：清顾客未读 + 标记运营消息为已读 */
    async markRead(ctx, conversationId) {
        const customer = await this.requireCustomer(ctx);
        const conversation = await this.requireOwnConversation(ctx, customer.id, conversationId);
        await this.markSideRead(ctx, conversation.id, 'admin', 'unreadForCustomer');
        return Object.assign(Object.assign({}, conversation), { unreadForCustomer: 0 });
    }
    /** 顾客结束会话（可再次发起新会话） */
    async closeConversation(ctx, conversationId) {
        const customer = await this.requireCustomer(ctx);
        const conversation = await this.requireOwnConversation(ctx, customer.id, conversationId);
        await this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).update(conversation.id, {
            status: 'closed',
            closedAt: new Date(),
        });
        return Object.assign(Object.assign({}, conversation), { status: 'closed' });
    }
    // ---------------- 后台侧 ----------------
    async adminConversations(ctx, status, unreadOnly, skip, take) {
        if (status && !exports.CHAT_STATUSES.includes(status))
            throw new core_1.UserInputError('会话状态不合法');
        const qb = this.connection
            .getRepository(ctx, chat_entities_1.CampusChatConversation)
            .createQueryBuilder('conversation')
            .where('conversation.channelId = :channelId', { channelId: ctx.channelId });
        if (status)
            qb.andWhere('conversation.status = :status', { status });
        if (unreadOnly)
            qb.andWhere('conversation.unreadForAdmin > 0');
        const [items, total] = await qb
            .orderBy('conversation.lastMessageAt', 'DESC', 'NULLS LAST')
            .addOrderBy('conversation.id', 'DESC')
            .skip(clampSkip(skip))
            .take(clampTake(take, 30))
            .getManyAndCount();
        const customers = items.length
            ? await this.connection.getRepository(ctx, core_1.Customer).findByIds(items.map(i => String(i.customerId)))
            : [];
        const byId = new Map(customers.map(c => [String(c.id), c]));
        // H2：后台会话列表顾客号码按号码保护口径展示
        const display = await this.phoneDisplayer(ctx);
        return {
            items: items.map(c => {
                const customer = byId.get(String(c.customerId));
                return Object.assign(Object.assign({}, c), { customerName: [customer === null || customer === void 0 ? void 0 : customer.firstName, customer === null || customer === void 0 ? void 0 : customer.lastName].filter(Boolean).join(' ') || '-', customerPhone: display(customer === null || customer === void 0 ? void 0 : customer.phoneNumber) });
            }),
            total,
        };
    }
    async adminMessages(ctx, conversationId, afterId, take) {
        const conversation = await this.requireChannelConversation(ctx, conversationId);
        const repo = this.connection.getRepository(ctx, chat_entities_1.CampusChatMessage);
        const limit = clampTake(take);
        const since = afterId == null || afterId === '' ? null : Number(afterId);
        const rows = await repo.find({
            where: Object.assign({ conversationId: conversation.id }, (since != null ? { id: (0, typeorm_1.MoreThan)(since) } : {})),
            order: { id: 'DESC' },
            take: limit,
        });
        return this.orderAsc(rows);
    }
    /** 后台回复：写消息 + 未读计数给顾客；顺带把运营侧未读清零（正在处理该会话） */
    async adminReply(ctx, conversationId, content, images) {
        var _a;
        const conversation = await this.requireChannelConversation(ctx, conversationId);
        const text = String(content !== null && content !== void 0 ? content : '').trim();
        const imgs = normalizeImages(images);
        if (!text && !imgs.length)
            throw new core_1.UserInputError('请填写回复内容');
        if (text.length > MAX_CONTENT)
            throw new core_1.UserInputError(`回复不能超过 ${MAX_CONTENT} 个字符`);
        const message = await this.connection.getRepository(ctx, chat_entities_1.CampusChatMessage).save({
            conversationId: conversation.id,
            senderType: 'admin',
            senderId: ctx.activeUserId ? Number(ctx.activeUserId) : null,
            content: text || null,
            images: imgs.length ? imgs : null,
            readAt: null,
        });
        await this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).update(conversation.id, {
            lastMessage: messageBrief(text || null, imgs),
            lastMessageAt: new Date(),
            lastSenderType: 'admin',
            unreadForCustomer: Number((_a = conversation.unreadForCustomer) !== null && _a !== void 0 ? _a : 0) + 1,
            unreadForAdmin: 0,
            // 回复即视为重新接待：已关闭会话被回复时自动恢复 open
            status: 'open',
            closedAt: null,
        });
        await this.markMessagesRead(ctx, conversation.id, 'customer');
        return message;
    }
    async adminClose(ctx, conversationId) {
        const conversation = await this.requireChannelConversation(ctx, conversationId);
        await this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).update(conversation.id, {
            status: 'closed',
            closedAt: new Date(),
            unreadForAdmin: 0,
        });
        await this.markMessagesRead(ctx, conversation.id, 'customer');
        return Object.assign(Object.assign({}, conversation), { status: 'closed' });
    }
    /** 会话列表未读角标：待处理会话数 + 未读消息数（工作台轮询用） */
    async adminUnread(ctx) {
        var _a, _b;
        const row = await this.connection
            .getRepository(ctx, chat_entities_1.CampusChatConversation)
            .createQueryBuilder('conversation')
            .select('COUNT(*)', 'conversations')
            .addSelect('COALESCE(SUM(conversation.unreadForAdmin), 0)', 'messages')
            .where('conversation.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('conversation.unreadForAdmin > 0')
            .getRawOne();
        return {
            conversationCount: Number((_a = row === null || row === void 0 ? void 0 : row.conversations) !== null && _a !== void 0 ? _a : 0),
            messageCount: Number((_b = row === null || row === void 0 ? void 0 : row.messages) !== null && _b !== void 0 ? _b : 0),
        };
    }
    // ---------------- 内部工具 ----------------
    async requireChannelConversation(ctx, conversationId) {
        const conversation = await this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).findOne({
            where: { id: conversationId, channelId: ctx.channelId },
        });
        if (!conversation)
            throw new core_1.UserInputError('会话不存在或不属于当前店铺');
        return conversation;
    }
    /** 后台在会话页停留即视为已读：清运营未读 + 标记顾客消息已读 */
    async markSideRead(ctx, conversationId, senderType, unreadField) {
        await this.connection.getRepository(ctx, chat_entities_1.CampusChatConversation).update(conversationId, {
            [unreadField]: 0,
        });
        await this.markMessagesRead(ctx, conversationId, senderType);
    }
    /** 把对方发来的未读消息标记为已读（readAt 幂等：仅补 NULL） */
    async markMessagesRead(ctx, conversationId, senderType) {
        await this.connection
            .getRepository(ctx, chat_entities_1.CampusChatMessage)
            .createQueryBuilder()
            .update()
            .set({ readAt: new Date() })
            .where('"conversationId" = :conversationId', { conversationId })
            .andWhere('"senderType" = :senderType', { senderType })
            .andWhere('"readAt" IS NULL')
            .execute();
    }
    orderAsc(rows) {
        return [...rows].sort((a, b) => Number(a.id) - Number(b.id));
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.CustomerService,
        feishu_notify_service_1.FeishuNotifyService,
        privacy_number_service_1.PrivacyNumberService])
], ChatService);
//# sourceMappingURL=chat.service.js.map