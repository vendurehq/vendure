import { Injectable } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { privacyProviderStatus, type PrivacyProviderStatus } from './waimai-store.service';

export interface PrivacyContact {
    /** 是否启用了号码保护（false 时 display 就是真实号） */
    protected: boolean;
    /** 展示用号码：脱敏号或虚拟号 */
    display: string | null;
    /** 可拨号码：虚拟号才有；null 表示不可拨（脱敏降级） */
    callable: string | null;
    provider: string;
    expiresAt: Date | null;
    /** 降级原因（provider 缺凭证等），前端可作提示 */
    note: string | null;
}

export interface PrivacySource {
    channelId: number | string;
    orderCode?: string | null;
    phone: string | null;
}

/**
 * 号码保护（P0）：商家/骑手/客服侧不直接拿顾客真实手机号。
 * Provider 抽象：
 * - mask：脱敏展示（零依赖，默认兜底）
 * - mock：本地虚拟号（演示用，不真实转接）
 * - aliyun / tencent：外部号池；缺凭证时运行时降级为 mask，绝不阻断订单流程
 */
@Injectable()
export class PrivacyNumberService {
    /** mock 虚拟号池：同一渠道/订单/真实号在 TTL 内保持稳定 */
    private readonly mockPool = new Map<string, { number: string; expiresAt: Date }>();
    /** 降级告警去重：`channelId:provider` 只提醒一次 */
    private readonly degradedWarned = new Set<string>();

    constructor(private connection: TransactionalConnection) {}

    /** 手机号脱敏：11 位保留前 3 后 4，其它保留首尾 */
    mask(phone: string | null | undefined): string | null {
        const raw = String(phone ?? '').replace(/\s/g, '');
        if (!raw) return null;
        if (/^\d{11}$/.test(raw)) return `${raw.slice(0, 3)}****${raw.slice(7)}`;
        if (raw.length >= 7) return `${raw.slice(0, 1)}***${raw.slice(-2)}`;
        if (raw.length >= 3) return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
        return '***';
    }

    /** 读取渠道隐私号配置（无配置行 = 未开启） */
    private async getConfig(ctx: RequestContext, channelId: number | string): Promise<CampusFulfillmentConfig | null> {
        return this.connection.getRepository(ctx, CampusFulfillmentConfig).findOne({
            where: { channelId: channelId as any },
        });
    }

    /**
     * 展示号转换器（H2）：一次读取渠道配置，返回同步转换函数。
     * 启用号码保护 → 脱敏号；未启用 → 原文。供列表/文案等 String 字段批量复用，避免逐条查配置。
     */
    async displayer(
        ctx: RequestContext,
        channelId: number | string,
    ): Promise<(phone: string | null | undefined) => string | null> {
        const cfg = await this.getConfig(ctx, channelId);
        const enabled = !!cfg?.privacyNumberEnabled;
        return phone => {
            const raw = String(phone ?? '').trim();
            if (!raw) return null;
            return enabled ? this.mask(raw) : raw;
        };
    }

    /**
     * 解析一个手机号在当前渠道下的展示方式。
     * 调用方：骑手任务联系人、商家工作台、客服台、运营侧工单。
     */
    async resolve(ctx: RequestContext, source: PrivacySource): Promise<PrivacyContact> {
        const real = String(source.phone ?? '').trim();
        const cfg = await this.getConfig(ctx, source.channelId);
        if (!cfg?.privacyNumberEnabled || !real) {
            return { protected: false, display: real || null, callable: real || null, provider: 'off', expiresAt: null, note: null };
        }
        const status = privacyProviderStatus(cfg);
        if (status.degraded) this.warnDegraded(source.channelId, status);

        if (status.effective === 'mock') {
            const ttl = Math.max(1, Number(cfg.privacyNumberTtlMinutes ?? 60)) * 60_000;
            const key = `${source.channelId}:${source.orderCode ?? ''}:${real}`;
            const now = Date.now();
            const hit = this.mockPool.get(key);
            if (hit && hit.expiresAt.getTime() > now) {
                return {
                    protected: true,
                    display: hit.number,
                    callable: hit.number,
                    provider: status.effective,
                    expiresAt: hit.expiresAt,
                    note: status.note,
                };
            }
            const prefix = String(cfg.privacyNumberPrefix ?? '').replace(/\D/g, '') || '1700000';
            const seed = Array.from(real).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 10000, 7);
            const number = `${prefix}${String(seed).padStart(4, '0')}`.slice(0, 11);
            const expiresAt = new Date(now + ttl);
            this.mockPool.set(key, { number, expiresAt });
            return {
                protected: true,
                display: number,
                callable: number,
                provider: status.effective,
                expiresAt,
                note: status.note,
            };
        }

        // mask 兜底（含 aliyun/tencent 未接入的降级）：只给脱敏号，不给可拨号
        return {
            protected: true,
            display: this.mask(real),
            callable: null,
            provider: status.effective,
            expiresAt: null,
            note: status.note,
        };
    }

    /** 降级告警去重：同一渠道同一服务商只提醒一次（进程内，多实例各自一条） */
    private warnDegraded(channelId: number | string, status: PrivacyProviderStatus): void {
        const key = `${channelId}:${status.provider}`;
        if (this.degradedWarned.has(key)) return;
        if (this.degradedWarned.size >= 500) this.degradedWarned.clear();
        this.degradedWarned.add(key);
        Logger.warn(`渠道 ${channelId} 隐私号配置为 ${status.provider}，实际回落 ${status.effective}：${status.note}`, 'PrivacyNumberService');
    }
}
