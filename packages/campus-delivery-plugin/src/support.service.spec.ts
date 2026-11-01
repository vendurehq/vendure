// 工单/申诉提醒单测：新工单/新申诉 → 飞书店铺定向提醒；回复/审核结果 → 站内信（Message+MessageDelivery）
import { describe, expect, it, vi } from 'vitest';
import { SupportService } from './support.service';
import { PrivacyNumberService } from './privacy-number.service';

const ctx = {
    channelId: 1,
    activeUserId: 99,
    channel: { id: 1, code: 'canteen-a' },
} as any;

function make(overrides?: {
    messageSaveThrows?: boolean;
    validCustomers?: number[];
    blacklistExists?: any[];
    /** 按订单号解析到的订单（null/未传 = 订单号不存在） */
    order?: any;
    /** 该订单在途售后单（findOne 用；find 用同一列表模拟列表回显） */
    afterSales?: any[];
    /** 模拟已安装售后插件：Injector.get(AfterSalesService) 返回该桩 */
    afterSalesSvc?: any;
    /** onAfterSalesStateChange 的待关闭工单 */
    openTickets?: any[];
    /** 值班表原始行（G3 自动指派：weekday/startMin/endMin/userId/userName） */
    dutyRows?: any[];
    /** 渠道号码保护配置行（null/未传 = 未开启，原文展示） */
    privacyConfig?: any;
}) {
    const customer = {
        id: 5,
        firstName: '张',
        lastName: '三',
        phoneNumber: '13800000000',
        customFields: { riderStatus: 'approved', riderRealName: '张三骑手' },
    } as any;
    const customerService = { findOneByUserId: vi.fn().mockResolvedValue(customer) } as any;
    const credit = { adjust: vi.fn().mockResolvedValue(undefined) } as any;
    const feishu = { pushEvent: vi.fn().mockResolvedValue(true) } as any;

    const saved: { entity: string; value: any }[] = [];
    const blacklistSaved: any[] = [];
    const blacklistUpdated: any[] = [];
    const existingRows = [...(overrides?.blacklistExists ?? [])];
    const repos: Record<string, any> = {
        CampusSupportTicket: {
            save: vi.fn((v: any) => Promise.resolve({ id: 11, ...v })),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            findOne: vi.fn(),
            find: vi.fn(() => Promise.resolve(overrides?.openTickets ?? [])),
            findAndCount: vi.fn().mockResolvedValue([[], 0]),
        },
        Order: {
            // 未传 order = 订单号不存在：工单仍可提交，仅不关联（宽松策略）
            findOne: vi.fn(() => Promise.resolve(overrides?.order ?? null)),
            // R7 系统工单关闭 → 回写 exceptionResolvedAt
            update: vi.fn().mockResolvedValue({ affected: 1 }),
        },
        AfterSalesRequest: {
            findOne: vi.fn(() => Promise.resolve((overrides?.afterSales ?? []).slice().sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null)),
            find: vi.fn(() => Promise.resolve(overrides?.afterSales ?? [])),
        },
        CampusRiderAppeal: {
            save: vi.fn((v: any) => Promise.resolve({ id: 21, ...v })),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            findOne: vi.fn(),
        },
        CampusBlacklist: {
            findOne: vi.fn(() => Promise.resolve(existingRows.shift() ?? null)),
            save: vi.fn((v: any) => {
                blacklistSaved.push(v);
                return Promise.resolve({ id: 300 + blacklistSaved.length, ...v });
            }),
            update: vi.fn((id: any, patch: any) => {
                blacklistUpdated.push({ id, patch });
                return Promise.resolve({ affected: 1 });
            }),
        },
        Customer: {
            findByIds: vi.fn().mockResolvedValue([customer]),
            createQueryBuilder: vi.fn(() => ({
                leftJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                andWhere: vi.fn().mockReturnThis(),
                getMany: vi.fn().mockResolvedValue(
                    (overrides?.validCustomers ?? []).map(id => ({ id })),
                ),
            })),
        },
        CampusFulfillmentConfig: {
            findOne: vi.fn(() => Promise.resolve(overrides?.privacyConfig ?? null)),
        },
        Message: {
            create: vi.fn((v: any) => v),
            save: vi.fn((v: any) => {
                if (overrides?.messageSaveThrows) return Promise.reject(new Error('no message table'));
                saved.push({ entity: 'Message', value: v });
                return Promise.resolve({ id: 101, ...v });
            }),
        },
        MessageDelivery: {
            create: vi.fn((v: any) => v),
            save: vi.fn((v: any) => {
                saved.push({ entity: 'MessageDelivery', value: v });
                return Promise.resolve({ id: 201, ...v });
            }),
        },
    };
    const connection = {
        getRepository: vi.fn((_ctx: any, entity: any) =>
            repos[typeof entity === 'string' ? entity : entity.name] ?? {}),
        rawConnection: {
            query: vi.fn().mockResolvedValue([overrides?.dutyRows ?? []]),
        },
    } as any;

    // Injector 只调 moduleRef.get：桩返回售后 Service（未传 = 未安装售后插件，联动降级）
    const moduleRef = overrides?.afterSalesSvc
        ? ({ get: vi.fn(() => overrides.afterSalesSvc) } as any)
        : undefined;
    const svc = new SupportService(
        connection,
        customerService,
        credit,
        feishu,
        moduleRef,
        overrides?.privacyConfig ? new PrivacyNumberService(connection) : undefined,
    );
    return { svc, repos, saved, credit, feishu, blacklistSaved, blacklistUpdated, moduleRef };
}

describe('SupportService 提醒', () => {
    it('新工单推飞书并带店铺定向', async () => {
        const { svc, feishu } = make();
        const ticket = await svc.createTicket(ctx, {
            category: 'delivery',
            content: '骑手把餐放错了楼栋',
            orderCode: 'A12345678',
        });
        expect(ticket).toMatchObject({ id: 11, status: 'open' });
        await vi.waitFor(() => expect(feishu.pushEvent).toHaveBeenCalledTimes(1));
        const [scene, title, content, orderCode, dedupe, target] = feishu.pushEvent.mock.calls[0];
        expect(scene).toBe('support_ticket');
        expect(title).toBe('新客服工单');
        expect(content).toContain('类型：delivery');
        expect(content).toContain('张 三');
        expect(content).toContain('A12345678');
        expect(orderCode).toBe('A12345678');
        expect(dedupe).toBe('ticket:11');
        expect(target).toEqual({ channel: 'canteen-a' });
    });

    it('新申诉推飞书并带骑手名', async () => {
        const { svc, repos, feishu } = make();
        repos.CampusRiderAppeal.findOne.mockResolvedValue(null);
        await svc.createAppeal(ctx, { reason: '客户地址错误导致超时' });
        await vi.waitFor(() => expect(feishu.pushEvent).toHaveBeenCalledTimes(1));
        const [scene, title, content, , dedupe, target] = feishu.pushEvent.mock.calls[0];
        expect(scene).toBe('rider_appeal');
        expect(title).toBe('新骑手申诉');
        expect(content).toContain('张三骑手');
        expect(content).toContain('未关联');
        expect(dedupe).toBe('appeal:21');
        expect(target).toEqual({ channel: 'canteen-a' });
    });

    it('回复工单给顾客发站内信', async () => {
        const { svc, repos, saved } = make();
        repos.CampusSupportTicket.findOne.mockResolvedValue({
            id: 11, channelId: 1, customerId: 5, status: 'open', reply: null,
        });
        await svc.replyTicket(ctx, 11, '已联系骑手补送');
        const msg = saved.find(s => s.entity === 'Message')?.value;
        const delivery = saved.find(s => s.entity === 'MessageDelivery')?.value;
        expect(msg).toMatchObject({
            title: '客服工单已回复',
            deliveryChannel: 'inapp',
            audienceType: 'all',
            status: 'sent',
            totalTarget: 1,
            totalSent: 1,
        });
        expect(msg.body).toContain('已联系骑手补送');
        expect(msg.body).toContain('#11');
        expect(delivery).toMatchObject({ messageId: 101, customerId: 5, deliveryStatus: 'sent' });
    });

    it('关闭工单给顾客发关闭站内信', async () => {
        const { svc, repos, saved } = make();
        repos.CampusSupportTicket.findOne.mockResolvedValue({
            id: 11, channelId: 1, customerId: 5, status: 'open', reply: '已处理',
        });
        await svc.replyTicket(ctx, 11, undefined, 'closed');
        const msg = saved.find(s => s.entity === 'Message')?.value;
        expect(msg.title).toBe('客服工单已关闭');
    });

    it('申诉通过回补信用分并通知骑手', async () => {
        const { svc, repos, saved, credit } = make();
        repos.CampusRiderAppeal.findOne.mockResolvedValue({
            id: 21, channelId: 1, riderCustomerId: 5, status: 'pending', orderId: 88, orderCode: 'A12345678',
        });
        await svc.reviewAppeal(ctx, 21, true, 15, '核实无责');
        expect(credit.adjust).toHaveBeenCalledWith(ctx, 5, 15, 'appeal_approved', 88);
        const msg = saved.find(s => s.entity === 'Message')?.value;
        expect(msg.title).toBe('骑手申诉已通过');
        expect(msg.body).toContain('信用分 +15');
        expect(msg.body).toContain('核实无责');
        expect(saved.find(s => s.entity === 'MessageDelivery')?.value.customerId).toBe(5);
    });

    it('申诉驳回只通知、不回补信用分', async () => {
        const { svc, repos, saved, credit } = make();
        repos.CampusRiderAppeal.findOne.mockResolvedValue({
            id: 21, channelId: 1, riderCustomerId: 5, status: 'pending', orderId: null, orderCode: null,
        });
        await svc.reviewAppeal(ctx, 21, false, 10, '证据不足');
        expect(credit.adjust).not.toHaveBeenCalled();
        const msg = saved.find(s => s.entity === 'Message')?.value;
        expect(msg.title).toBe('骑手申诉未通过');
        expect(msg.body).toContain('信用分不变');
        expect(msg.body).toContain('证据不足');
    });

    it('站内信不可用（无 message-plugin）不影响工单回复', async () => {
        const { svc, repos } = make({ messageSaveThrows: true });
        repos.CampusSupportTicket.findOne.mockResolvedValue({
            id: 11, channelId: 1, customerId: 5, status: 'open', reply: null,
        });
        await expect(svc.replyTicket(ctx, 11, '已处理')).resolves.toMatchObject({ status: 'replied' });
    });
});

// P2 工单与售后打通：建单关联订单/在途售后单、回复同步协商留言、退款到账自动关单、手工关联校验
describe('SupportService 工单与售后打通', () => {
    const myOrder = { id: 88, code: 'A1', customer: { id: 5 }, channels: [{ id: 1 }] };

    it('建单按订单号关联本人订单与在途售后单', async () => {
        const { svc, repos, feishu } = make({
            order: myOrder,
            afterSales: [{ id: 77, state: 'Pending', orderId: 88 }],
        });
        const ticket = await svc.createTicket(ctx, { category: 'refund', content: '少送一份', orderCode: 'A1' });
        expect(ticket).toMatchObject({ orderId: 88, afterSalesRequestId: 77 });
        expect(repos.CampusSupportTicket.save.mock.calls[0][0]).toMatchObject({ orderId: 88, afterSalesRequestId: 77 });
        await vi.waitFor(() => expect(feishu.pushEvent).toHaveBeenCalledTimes(1));
        expect(feishu.pushEvent.mock.calls[0][2]).toContain('售后单：#77');
    });

    it('订单号属于他人 → 拒绝建单（防把工单挂到他人订单）', async () => {
        const { svc, repos } = make({ order: { ...myOrder, customer: { id: 6 } } });
        await expect(svc.createTicket(ctx, { category: 'refund', content: '退款', orderCode: 'A1' }))
            .rejects.toThrow('订单号不存在或不属于本人');
        expect(repos.CampusSupportTicket.save).not.toHaveBeenCalled();
    });

    it('订单号不存在 → 仍可建单，仅不关联（不因写错订单号失去投诉入口）', async () => {
        const { svc } = make();
        const ticket = await svc.createTicket(ctx, { category: 'delivery', content: '送错楼栋', orderCode: 'B404' });
        expect(ticket.orderId).toBeNull();
        expect(ticket.afterSalesRequestId).toBeNull();
    });

    it('客服回复同步写入售后协商留言（同一结论两边可见）', async () => {
        const addMessage = vi.fn().mockResolvedValue({});
        const { svc, repos, moduleRef } = make({ afterSalesSvc: { addMessage } });
        repos.CampusSupportTicket.findOne.mockResolvedValue({
            id: 11, channelId: 1, customerId: 5, status: 'open', reply: null, afterSalesRequestId: 77,
        });
        await svc.replyTicket(ctx, 11, '已为您加急退款');
        expect(moduleRef.get).toHaveBeenCalled();
        expect(addMessage).toHaveBeenCalledWith(ctx, 77, 'admin', '已为您加急退款');
    });

    it('未关联售后单的工单回复不触发售后留言（无售后插件也不报错）', async () => {
        const { svc, repos } = make();
        repos.CampusSupportTicket.findOne.mockResolvedValue({
            id: 11, channelId: 1, customerId: 5, status: 'open', reply: null, afterSalesRequestId: null,
        });
        await expect(svc.replyTicket(ctx, 11, '已处理')).resolves.toMatchObject({ status: 'replied' });
    });

    it('退款到账自动关闭关联工单，其它售后状态不动', async () => {
        const { svc, repos } = make({ openTickets: [{ id: 11, reply: '已联系骑手' }] });
        await svc.onAfterSalesStateChange(ctx, 77, 'Approved');
        expect(repos.CampusSupportTicket.update).not.toHaveBeenCalled();
        await svc.onAfterSalesStateChange(ctx, 77, 'Refunded');
        expect(repos.CampusSupportTicket.update).toHaveBeenCalledWith(
            11,
            expect.objectContaining({ status: 'closed', repliedBy: 'system' }),
        );
    });

    it('手工关联售后单：订单不一致拒绝', async () => {
        const { svc, repos } = make({ afterSales: [{ id: 77, orderId: 99, channels: [{ id: 1 }] }] });
        repos.CampusSupportTicket.findOne.mockResolvedValue({ id: 11, channelId: 1, orderId: 88 });
        await expect(svc.linkTicketAfterSales(ctx, 11, 77)).rejects.toThrow('售后单与工单关联订单不一致');
    });

    it('手工关联售后单：同店同订单通过并补齐订单字段', async () => {
        const { svc, repos } = make({ afterSales: [{ id: 77, state: 'Pending', orderId: 88, channels: [{ id: 1 }] }] });
        repos.CampusSupportTicket.findOne.mockResolvedValue({ id: 11, channelId: 1, orderId: null });
        const res = await svc.linkTicketAfterSales(ctx, 11, 77);
        expect(res).toMatchObject({ orderId: 88, afterSalesRequestId: 77, afterSalesState: 'Pending' });
        expect(repos.CampusSupportTicket.update).toHaveBeenCalledWith(
            11,
            expect.objectContaining({ orderId: 88, afterSalesRequestId: 77 }),
        );
    });
});

// P3-2 批量导入：格式非法/重复/已存在/非本店用户分别计数
describe('SupportService.importBlacklist', () => {
    it('手机号批量导入：非法行计 invalid，重复行去重', async () => {
        const { svc, blacklistSaved } = make();
        const res = await svc.importBlacklist(ctx, 'phone', ['13800000000', 'bad', '13800000000', ' 139 0000 0000 ']);
        expect(res).toEqual({ added: 2, skipped: 0, invalid: 1 });
        expect(blacklistSaved.map(v => v.phone)).toEqual(['13800000000', '13900000000']);
        expect(blacklistSaved[0]).toMatchObject({ channelId: 1, type: 'phone', createdBy: '99', active: true });
    });

    it('用户 ID 批量导入：不存在/非本店铺计 invalid', async () => {
        const { svc, blacklistSaved } = make({ validCustomers: [5] });
        const res = await svc.importBlacklist(ctx, 'user', ['5', '7', 'abc']);
        expect(res).toEqual({ added: 1, skipped: 0, invalid: 2 });
        expect(blacklistSaved).toHaveLength(1);
        expect(blacklistSaved[0]).toMatchObject({ type: 'user', customerId: 5, phone: null });
    });

    it('已存在的生效记录计入 skipped；已删除记录重新激活计入 added', async () => {
        const { svc, blacklistSaved, blacklistUpdated } = make({
            validCustomers: [5, 7],
            blacklistExists: [{ id: 41, active: true }, { id: 42, active: false }],
        });
        const res = await svc.importBlacklist(ctx, 'user', ['5', '7'], '活动刷单');
        expect(res).toEqual({ added: 1, skipped: 1, invalid: 0 });
        expect(blacklistUpdated).toEqual([{ id: 42, patch: { active: true, reason: '活动刷单' } }]);
        expect(blacklistSaved).toHaveLength(0);
    });

    it('空列表与超量导入直接拒绝', async () => {
        const { svc } = make();
        await expect(svc.importBlacklist(ctx, 'phone', [])).rejects.toThrow('请粘贴要导入的用户 ID 或手机号');
        await expect(svc.importBlacklist(ctx, 'phone', Array.from({ length: 501 }, (_, i) => `138${i}`))).rejects.toThrow('单次最多导入 500 条');
        await expect(svc.importBlacklist(ctx, 'email' as any, ['a@b.c'])).rejects.toThrow('黑名单类型不合法');
    });
});

// R7 外部运单异常 → 系统工单：无顾客、幂等建单、关闭回写订单已处置
describe('SupportService 系统工单（R7）', () => {
    const input = {
        dedupeKey: 'third_party:A1:TP-1',
        orderCode: 'A1',
        orderId: 88,
        category: 'delivery',
        source: 'third_party_exception',
        content: '外部运单异常：平台顺丰，运单 TP-1',
        channelId: 1,
    };

    it('同 dedupeKey 已存在 → 复用不重复建单、不重复告警', async () => {
        const { svc, repos, feishu } = make();
        repos.CampusSupportTicket.findOne.mockResolvedValue({ id: 33, dedupeKey: input.dedupeKey });
        const res = await svc.createSystemTicket(ctx, input);
        expect(res).toEqual({ id: 33, created: false });
        expect(repos.CampusSupportTicket.save).not.toHaveBeenCalled();
        expect(feishu.pushEvent).not.toHaveBeenCalled();
    });

    it('新建系统工单 customerId=null 并推飞书（带工单号去重键）', async () => {
        const { svc, repos, feishu } = make();
        repos.CampusSupportTicket.findOne.mockResolvedValue(null);
        const res = await svc.createSystemTicket(ctx, input);
        expect(res).toEqual({ id: 11, created: true });
        expect(repos.CampusSupportTicket.save.mock.calls[0][0]).toMatchObject({
            channelId: 1,
            customerId: null,
            orderCode: 'A1',
            orderId: 88,
            afterSalesRequestId: null,
            category: 'delivery',
            status: 'open',
            source: 'third_party_exception',
            dedupeKey: input.dedupeKey,
        });
        await vi.waitFor(() => expect(feishu.pushEvent).toHaveBeenCalledTimes(1));
        expect(feishu.pushEvent.mock.calls[0][1]).toBe('系统工单：外部运单异常');
        expect(feishu.pushEvent.mock.calls[0][4]).toBe('ticket:11');
    });

    it('并发唯一索引冲突 → 回查已存在工单，不阻断调度', async () => {
        const { svc, repos } = make();
        repos.CampusSupportTicket.findOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 44, dedupeKey: input.dedupeKey });
        repos.CampusSupportTicket.save.mockRejectedValueOnce(new Error('duplicate key'));
        const res = await svc.createSystemTicket(ctx, input);
        expect(res).toEqual({ id: 44, created: false });
    });

    it('关闭外部异常工单 → 回写订单 exceptionResolvedAt（调度不再重复告警）', async () => {
        const { svc, repos, saved } = make();
        repos.CampusSupportTicket.findOne.mockResolvedValue({
            id: 11, channelId: 1, customerId: null, status: 'open', reply: null,
            source: 'third_party_exception', orderId: 88,
        });
        await svc.replyTicket(ctx, 11, undefined, 'closed');
        expect(repos.Order.update).toHaveBeenCalledWith(
            88,
            expect.objectContaining({ campusCause: 'third_party_exception_resolved' }),
        );
        expect(repos.Order.update.mock.calls[0][1].customFields.exceptionResolvedAt).toBeInstanceOf(Date);
        // 无顾客系统工单不发站内信
        expect(saved.find(s => s.entity === 'Message')).toBeUndefined();
    });

    it('关闭顾客工单不回写订单异常标记', async () => {
        const { svc, repos } = make();
        repos.CampusSupportTicket.findOne.mockResolvedValue({
            id: 11, channelId: 1, customerId: 5, status: 'open', reply: null, source: 'customer', orderId: 88,
        });
        await svc.replyTicket(ctx, 11, undefined, 'closed');
        expect(repos.Order.update).not.toHaveBeenCalled();
    });

    it('管理端工单可按来源筛选；非法来源拒绝', async () => {
        const { svc, repos } = make();
        await svc.adminTickets(ctx, undefined, undefined, undefined, 'third_party_exception');
        expect(repos.CampusSupportTicket.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
            where: { channelId: 1, source: 'third_party_exception' },
        }));
        await expect(svc.adminTickets(ctx, undefined, undefined, undefined, 'bad'))
            .rejects.toThrow('工单来源不合法');
    });

    it('系统工单按值班表自动指派值班人（飞书文案带值班人）', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-29T10:00:00+08:00').getTime());
        const { svc, repos, feishu } = make({
            dutyRows: [{ weekday: 4, startMin: 480, endMin: 720, userId: 7, userName: '李四' }],
        });
        repos.CampusSupportTicket.findOne.mockResolvedValue(null);
        await svc.createSystemTicket(ctx, input);
        expect(repos.CampusSupportTicket.save.mock.calls[0][0]).toMatchObject({ assigneeId: 7 });
        await vi.waitFor(() => expect(feishu.pushEvent).toHaveBeenCalledTimes(1));
        expect(feishu.pushEvent.mock.calls[0][2]).toContain('值班：李四');
        vi.restoreAllMocks();
    });

    it('无值班人 → assigneeId=null，飞书提示人工认领', async () => {
        const { svc, repos, feishu } = make();
        repos.CampusSupportTicket.findOne.mockResolvedValue(null);
        await svc.createSystemTicket(ctx, input);
        expect(repos.CampusSupportTicket.save.mock.calls[0][0]).toMatchObject({ assigneeId: null });
        await vi.waitFor(() => expect(feishu.pushEvent).toHaveBeenCalledTimes(1));
        expect(feishu.pushEvent.mock.calls[0][2]).toContain('未排班（请人工认领）');
    });

    it('管理端可按 assigneeId 过滤；非法值拒绝', async () => {
        const { svc, repos } = make();
        await svc.adminTickets(ctx, undefined, undefined, undefined, undefined, '7');
        expect(repos.CampusSupportTicket.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
            where: { channelId: 1, assigneeId: 7 },
        }));
        await expect(svc.adminTickets(ctx, undefined, undefined, undefined, undefined, 'abc'))
            .rejects.toThrow('值班人 id 不合法');
    });
});

describe('SupportService 号码保护（H2）', () => {
    const privacyConfig = { privacyNumberEnabled: true, privacyNumberProvider: 'mask' };

    it('启用号码保护：飞书文案脱敏，不出现顾客明文号', async () => {
        const { svc, feishu } = make({ privacyConfig });
        await svc.createTicket(ctx, { category: 'delivery', content: '餐送错楼栋' });
        await vi.waitFor(() => expect(feishu.pushEvent).toHaveBeenCalledTimes(1));
        const content = feishu.pushEvent.mock.calls[0][2];
        expect(content).toContain('138****0000');
        expect(content).not.toContain('13800000000');
    });

    it('启用号码保护：后台工单列表返回脱敏号', async () => {
        const { svc, repos } = make({ privacyConfig });
        repos.CampusSupportTicket.findAndCount.mockResolvedValue([[{ id: 11, customerId: 5 }], 1]);
        const list: any = await svc.adminTickets(ctx);
        expect(list.items[0].customerPhone).toBe('138****0000');
    });

    it('未开启号码保护：保持原文展示', async () => {
        const { svc, feishu } = make();
        await svc.createTicket(ctx, { category: 'delivery', content: '餐送错楼栋' });
        await vi.waitFor(() => expect(feishu.pushEvent).toHaveBeenCalledTimes(1));
        expect(feishu.pushEvent.mock.calls[0][2]).toContain('13800000000');
    });
});

