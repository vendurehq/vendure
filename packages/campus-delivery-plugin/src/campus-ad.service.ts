// P2-3 广告位与商家自助投放计费：下单（按天计费）→ 模拟支付 → 平台审核 → 按日期投放。
//
// 商家侧只能看到/操作本渠道投放单；平台侧按渠道查询并审核。
// 已结束状态不落库，按投放结束日实时判定（避免额外定时任务）。
import { Injectable } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { LessThan, MoreThanOrEqual } from 'typeorm';
import { CampusAdCampaign } from './campus-ad.entity';
import { AD_SLOTS, adViewStatus, calcAdQuote, findAdSlot, isAdLive, normalizeAdDate } from './ad-slots';
import { campusDayKey } from './campus-time';

export interface AdCampaignInput {
    slot: string;
    title: string;
    imageUrl?: string | null;
    linkUrl?: string | null;
    startDate: string;
    endDate: string;
}

const MAX_ACTIVE_PER_SLOT = 3;

@Injectable()
export class CampusAdService {
    constructor(private connection: TransactionalConnection) {}

    private repo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, CampusAdCampaign);
    }

    private today(): string {
        return campusDayKey(Date.now());
    }

    /** 对外视图：status 按日期改写为 finished，并给出 live */
    private toView(row: CampusAdCampaign) {
        const today = this.today();
        return { ...row, status: adViewStatus(row, today), live: isAdLive(row, today) };
    }

    slotList() {
        return AD_SLOTS.map(s => ({ code: s.code, name: s.name, unitPriceFen: s.unitPriceFen }));
    }

    /** 商家侧：本渠道投放单（最近 50 条） */
    async merchantList(ctx: RequestContext) {
        const rows = await this.repo(ctx).find({ where: { channelId: ctx.channelId as any }, order: { createdAt: 'DESC' }, take: 50 });
        return rows.map(r => this.toView(r));
    }

    /** 商家下单：校验广告位与素材，按下单当时的单价固化总价，状态 pendingPay */
    async create(ctx: RequestContext, input: AdCampaignInput) {
        const slot = findAdSlot(String(input?.slot ?? '').trim());
        const title = String(input?.title ?? '').trim();
        if (!title) throw new UserInputError('广告标题不能为空');
        if (title.length > 40) throw new UserInputError('广告标题不能超过 40 个字符');
        const imageUrl = String(input?.imageUrl ?? '').trim();
        if (imageUrl) {
            if (!/^https?:\/\//i.test(imageUrl) || imageUrl.length > 512) throw new UserInputError('广告图片需为 http(s) 地址且不超过 512 字符');
        }
        const linkUrl = String(input?.linkUrl ?? '').trim();
        if (linkUrl) {
            if (!/^(https?:\/\/|\/pages\/)/i.test(linkUrl) || linkUrl.length > 255) throw new UserInputError('跳转链接需为 http(s) 地址或以 /pages/ 开头的站内路径');
        }
        const quote = calcAdQuote(slot.code, input.startDate, input.endDate);
        const row = await this.repo(ctx).save(
            new CampusAdCampaign({
                channelId: ctx.channelId as any,
                slot: slot.code,
                title,
                imageUrl: imageUrl || null,
                linkUrl: linkUrl || null,
                startDate: normalizeAdDate(input.startDate, '开始日期'),
                endDate: normalizeAdDate(input.endDate, '结束日期'),
                days: quote.days,
                unitPriceFen: quote.unitPriceFen,
                totalFen: quote.totalFen,
                status: 'pendingPay',
                createdBy: ctx.activeUserId ? String(ctx.activeUserId) : null,
            }),
        );
        return this.toView(row);
    }

    /** 商家支付（模拟）：生成支付流水号并转待审核；重复支付幂等返回 */
    async pay(ctx: RequestContext, id: ID) {
        const row = await this.findOwn(ctx, id);
        if (row.status === 'pendingReview' || row.status === 'running' || row.status === 'finished') return this.toView(row);
        if (row.status !== 'pendingPay') throw new UserInputError('当前状态不可支付');
        row.status = 'pendingReview';
        row.payRef = `ADPAY-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
        row.paidAt = new Date();
        await this.repo(ctx).save(row);
        return this.toView(row);
    }

    /** 商家取消：仅未支付/待审核可取消 */
    async cancel(ctx: RequestContext, id: ID) {
        const row = await this.findOwn(ctx, id);
        if (row.status !== 'pendingPay' && row.status !== 'pendingReview') throw new UserInputError('当前状态不可取消');
        row.status = 'cancelled';
        await this.repo(ctx).save(row);
        return this.toView(row);
    }

    /**
     * 平台侧：按渠道/状态分页查询投放单（§122）。
     * status 是视图态：finished 在库里仍是 running，按结束日反推，
     * 保证「筛选口径 = 列表 pill 口径」；take 默认 20、上限 100。
     */
    async adminList(
        ctx: RequestContext,
        status?: string | null,
        channelId?: ID | null,
        skip = 0,
        take = 20,
    ): Promise<{ total: number; items: any[] }> {
        const where: any = {};
        if (channelId) where.channelId = channelId as any;
        else where.channelId = ctx.channelId as any;
        const st = String(status ?? '').trim();
        const today = this.today();
        if (st === 'finished') {
            where.status = 'running';
            where.endDate = LessThan(today);
        } else if (st === 'running') {
            where.status = 'running';
            where.endDate = MoreThanOrEqual(today);
        } else if (st) {
            where.status = st;
        }
        const safeTake = Math.min(100, Math.max(1, Math.floor(Number(take) || 20)));
        const safeSkip = Math.max(0, Math.floor(Number(skip) || 0));
        const [rows, total] = await this.repo(ctx).findAndCount({
            where,
            order: { createdAt: 'DESC', id: 'DESC' },
            skip: safeSkip,
            take: safeTake,
        });
        return { total, items: rows.map(r => this.toView(r)) };
    }

    /** 平台审核：通过 → running；驳回 → rejected（须填原因） */
    async review(ctx: RequestContext, id: ID, approve: boolean, note?: string | null) {
        const row = await this.repo(ctx).findOne({ where: { id: id as any } });
        if (!row) throw new UserInputError('投放单不存在');
        if (row.status !== 'pendingReview') throw new UserInputError('只有待审核的投放单可以审核');
        const reason = String(note ?? '').trim();
        if (!approve && !reason) throw new UserInputError('驳回时必须填写原因');
        if (reason.length > 200) throw new UserInputError('审核备注不能超过 200 个字符');
        row.status = approve ? 'running' : 'rejected';
        row.reviewNote = reason || null;
        row.reviewedBy = ctx.activeUserId ? String(ctx.activeUserId) : null;
        row.reviewedAt = new Date();
        await this.repo(ctx).save(row);
        return this.toView(row);
    }

    /** C 端公开：本渠道某广告位当前在投的广告（最多 3 条） */
    async activeAds(ctx: RequestContext, slotCode: string) {
        const slot = findAdSlot(String(slotCode ?? '').trim());
        const today = this.today();
        const rows = await this.repo(ctx).find({
            where: { channelId: ctx.channelId as any, slot: slot.code, status: 'running' },
            order: { totalFen: 'DESC', createdAt: 'ASC' },
            take: MAX_ACTIVE_PER_SLOT,
        });
        return rows.filter(r => isAdLive(r, today)).map(r => ({
            id: r.id,
            slot: r.slot,
            title: r.title,
            imageUrl: r.imageUrl,
            linkUrl: r.linkUrl,
            endDate: r.endDate,
        }));
    }

    private async findOwn(ctx: RequestContext, id: ID) {
        const row = await this.repo(ctx).findOne({ where: { id: id as any, channelId: ctx.channelId as any } });
        if (!row) throw new UserInputError('投放单不存在');
        return row;
    }
}
