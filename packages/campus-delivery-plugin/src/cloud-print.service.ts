/**
 * 云打印（P1-4）：把小票直接推到商家云打印机（飞鹅 / 易联云），商家无需常开工作台页面。
 *
 * 与本地 LODOP 的关系：printProvider='local' 仍走前端 C-Lodop（商家电脑装服务）；
 * 'feie' / 'yilianyun' 由服务端签名直连服务商 OpenAPI，成功即回写 waimaiPrintedAt，
 * 并落一条 campus_print_job 任务留痕（后台可看失败原因并重打）。
 *
 * 安全：密钥只在服务端使用，签名按服务商文档（飞鹅 SHA1(user+ukey+stime)；
 * 易联云 MD5(client_id+timestamp+client_secret)），密钥/账号不进日志。
 */
import { createHash, randomUUID } from 'crypto';
import { dbNowWallToInstant } from './db-now-wall';
import { ID, Order, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { Injectable } from '@nestjs/common';
import { CampusConfigService } from './campus-config.service';
import { CampusBuilding } from './campus-building.entity';
import { CampusPrintJob } from './campus-print-job.entity';
import { HallService } from './hall.service';
import { addonDisplayText } from './addon-fee';
import { PRINT_PROVIDERS } from './waimai-store.service';

export type PrintProvider = (typeof PRINT_PROVIDERS)[number];

const FEIE_ENDPOINT = 'https://api.feieyun.cn/Api/Open/';
const YLY_OAUTH_ENDPOINT = 'https://open-api.10ss.net/oauth/oauth';
const YLY_PRINT_ENDPOINT = 'https://open-api.10ss.net/print/index';
const HTTP_TIMEOUT_MS = 8000;

export interface CloudPrintResult {
    ok: boolean;
    provider: string;
    dryRun: boolean;
    jobId: string | null;
    error: string | null;
}

export interface CloudPrintJobRow {
    id: string;
    orderId: string | null;
    orderCode: string | null;
    provider: string;
    deviceSn: string | null;
    status: string;
    triggerType: string;
    copies: number;
    dryRun: boolean;
    errorMessage: string | null;
    durationMs: number | null;
    createdAt: Date;
}

interface TicketLine {
    name: string;
    quantity: number;
    price: number; // 分（单价）
    addons: string[];
}

interface TicketData {
    storeName: string;
    storePhone: string | null;
    code: string;
    createdAtText: string;
    zone: string;
    building: string;
    slotText: string;
    route: string;
    note: string | null;
    lines: TicketLine[];
    subtotal: number;
    shipping: number;
    total: number;
    title?: string; // 测试打印标题
}

const money = (fen: number) => (fen / 100).toFixed(2);

/** 服务商内容均为 HTML 片段：转义商品名里的尖括号/&，避免把话术当标签解析 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pad2(n: number) {
    return String(n).padStart(2, '0');
}

/** 小票时间按校园时区（UTC+8）展示，避免服务器时区漂移 */
function campusTimeText(d: Date): string {
    const t = new Date(d.getTime() + 8 * 3600 * 1000);
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** 58mm 纯文本小票（服务商按 <BR> 换行） */
export function buildTicketContent(d: TicketData): string {
    const rows: string[] = [];
    rows.push(`<CB>${esc(d.title ?? d.storeName)}</CB>`);
    if (!d.title && d.storePhone) rows.push(esc(d.storePhone));
    rows.push('--------------------------------');
    rows.push(`单号：${esc(d.code)}`);
    rows.push(`时间：${d.createdAtText}`);
    if (d.route) rows.push(`路线：${esc(d.route)}`);
    if (d.zone || d.building) rows.push(`送达：${esc(d.zone)} ${esc(d.building)}`);
    if (d.slotText) rows.push(`时段：${esc(d.slotText)}`);
    rows.push('--------------------------------');
    for (const l of d.lines) {
        rows.push(`${esc(l.name)} x${l.quantity}    ¥${money(l.price * l.quantity)}`);
        if (l.addons.length) rows.push(`  加料：${esc(l.addons.join(' / '))}`);
    }
    rows.push('--------------------------------');
    rows.push(`小计：¥${money(d.subtotal)}`);
    rows.push(`配送费：¥${money(d.shipping)}`);
    rows.push(`<B>合计：¥${money(d.total)}</B>`);
    if (d.note) {
        rows.push('--------------------------------');
        rows.push(`备注：${esc(d.note)}`);
    }
    rows.push('--------------------------------');
    rows.push(`谢谢惠顾，欢迎再次光临`);
    return rows.join('<BR>');
}

@Injectable()
export class CloudPrintService {
    /** 易联云 access_token 缓存（按 client_id），提前 5 分钟过期重取 */
    private ylyTokens = new Map<string, { token: string; expiresAt: number }>();

    constructor(
        private connection: TransactionalConnection,
        private config: CampusConfigService,
        private hall: HallService,
    ) {}

    /** 云打印一张订单小票：失败不抛给调用方（自动触发时不能因打印机故障卡住接单） */
    async printOrder(ctx: RequestContext, orderId: ID, trigger: 'auto' | 'manual'): Promise<CloudPrintResult> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId as any },
            relations: ['channels', 'lines', 'lines.productVariant'],
        });
        if (!order) throw new UserInputError('订单不存在');
        const inChannel = order.channels?.some(c => String(c.id) === String(ctx.channelId));
        if (!inChannel) throw new UserInputError('订单不存在或不属于当前店铺');

        const cfg = await this.config.getConfig(ctx);
        const provider = String(cfg.printProvider ?? 'local');
        if (provider === 'local') {
            return { ok: false, provider, dryRun: false, jobId: null, error: '当前店铺使用本地打印（C-Lodop），无需云打印' };
        }

        const cf = order.customFields as any;
        const buildingName = cf.buildingId
            ? await this.connection.getRepository(ctx, CampusBuilding).findOne({ where: { id: cf.buildingId } })
            : null;
        const data: TicketData = {
            storeName: ctx.channel?.code ?? '',
            storePhone: cfg.storePhone ?? null,
            code: order.code,
            // 小票上的下单时间：order.createdAt 是 DB now() 写入的 UTC 墙钟，先还原再按北京时区打印
            createdAtText: campusTimeText(dbNowWallToInstant(order.createdAt)),
            zone: String(cf.campusZone ?? ''),
            building: buildingName?.name ?? '',
            slotText: String(cf.deliverySlotText ?? ''),
            route: String(cf.fulfillmentRoute ?? ''),
            note: cf.note ?? null,
            lines: (order.lines ?? []).map(l => {
                const addonsText = addonDisplayText((l.customFields as any)?.waimaiAddons);
                return {
                    name: l.productVariant?.name ?? '',
                    quantity: l.quantity,
                    price: l.unitPrice,
                    addons: addonsText ? addonsText.split(' / ') : [],
                };
            }),
            subtotal: (order.lines ?? []).reduce((s, l) => s + l.unitPrice * l.quantity, 0),
            shipping: order.shipping,
            total: order.total,
        };

        const result = await this.dispatch(
            ctx,
            provider as PrintProvider,
            data,
            Number(cfg.printCopies ?? 1),
            trigger,
            order.id as any,
        );
        if (result.ok) {
            // 打印回执：与前端 LODOP 打印同源，防重打 + 补打依据
            await this.hall.updateOrder(ctx, order.id as any, {
                customFields: { waimaiPrintedAt: new Date() },
            } as any);
        }
        return result;
    }

    /** 测试打印：不绑定订单，仅验证账号/设备/签名是否可用 */
    async testPrint(ctx: RequestContext): Promise<CloudPrintResult> {
        const cfg = await this.config.getConfig(ctx);
        const provider = String(cfg.printProvider ?? 'local');
        if (provider === 'local') {
            return { ok: false, provider, dryRun: false, jobId: null, error: '当前为本地打印通道，请在商家工作台点「补打」验证 C-Lodop' };
        }
        const now = new Date();
        const data: TicketData = {
            storeName: ctx.channel?.code ?? '',
            storePhone: cfg.storePhone ?? null,
            code: 'TEST-PRINT',
            createdAtText: campusTimeText(now),
            zone: '',
            building: '',
            slotText: '',
            route: '',
            note: null,
            lines: [{ name: '云打印测试', quantity: 1, price: 0, addons: [] }],
            subtotal: 0,
            shipping: 0,
            total: 0,
            title: `打印测试 · ${ctx.channel?.code ?? ''}`,
        };
        return this.dispatch(ctx, provider as PrintProvider, data, 1, 'test', null);
    }

    /** 最近打印任务（后台排障：失败原因、耗时、是否模拟） */
    async recentJobs(ctx: RequestContext, limit?: number): Promise<CloudPrintJobRow[]> {
        const take = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 100);
        const jobs = await this.connection.getRepository(ctx, CampusPrintJob).find({
            where: { channelId: ctx.channelId as any },
            order: { id: 'DESC' },
            take,
        });
        const orderIds = [...new Set(jobs.map(j => Number(j.orderId)).filter(n => n > 0))];
        const orders = orderIds.length
            ? await this.connection.getRepository(ctx, Order).findByIds(orderIds as any)
            : [];
        const codeById = new Map(orders.map(o => [String(o.id), o.code]));
        return jobs.map(j => ({
            id: String(j.id),
            orderId: j.orderId ? String(j.orderId) : null,
            orderCode: j.orderId ? codeById.get(String(j.orderId)) ?? null : null,
            provider: j.provider,
            deviceSn: j.deviceSn ?? null,
            status: j.status,
            triggerType: j.triggerType,
            copies: j.copies,
            dryRun: j.dryRun,
            errorMessage: j.errorMessage ?? null,
            durationMs: j.durationMs ?? null,
            createdAt: j.createdAt,
        }));
    }

    /** 统一落任务 + 调服务商：任何异常都收敛为任务失败，不向上抛错 */
    private async dispatch(
        ctx: RequestContext,
        provider: PrintProvider,
        data: TicketData,
        copies: number,
        trigger: 'auto' | 'manual' | 'test',
        orderId: ID | null,
    ): Promise<CloudPrintResult> {
        const cfg = await this.config.getConfig(ctx);
        const repo = this.connection.getRepository(ctx, CampusPrintJob);
        const content = buildTicketContent(data);
        const safeCopies = Math.min(Math.max(Number(copies) || 1, 1), 5);
        const job = await repo.save(
            new CampusPrintJob({
                orderId: orderId ? Number(orderId) : null,
                channelId: ctx.channelId,
                provider,
                deviceSn: cfg.printDeviceSn ?? null,
                status: 'pending',
                triggerType: trigger,
                copies: safeCopies,
                content,
            } as any),
        );
        const startedAt = Date.now();
        try {
            const account = String(cfg.printAccount ?? '').trim();
            const sn = String(cfg.printDeviceSn ?? '').trim();
            const key = String(cfg.printDeviceKey ?? '').trim();
            if (!account || !sn || !key) {
                throw new Error('云打印未配置：请填写服务商账号、设备编号与密钥');
            }
            if (provider === 'feie') {
                await this.sendFeie(account, key, sn, content, safeCopies);
            } else if (provider === 'yilianyun') {
                await this.sendYilianyun(account, key, sn, content);
            } else {
                throw new Error(`不支持的打印通道: ${provider}`);
            }
            job.status = 'ok';
            job.dryRun = false;
            job.errorMessage = null;
            job.durationMs = Date.now() - startedAt;
            await repo.save(job);
            return { ok: true, provider, dryRun: false, jobId: String(job.id), error: null };
        } catch (e: any) {
            job.status = 'failed';
            job.errorMessage = String(e?.message ?? e).slice(0, 500);
            job.durationMs = Date.now() - startedAt;
            await repo.save(job);
            // eslint-disable-next-line no-console
            console.error(`[CloudPrint] ${provider} print failed (job ${job.id}):`, job.errorMessage);
            return { ok: false, provider, dryRun: false, jobId: String(job.id), error: job.errorMessage };
        }
    }

    /** 飞鹅云：Open_printMsg（sig=SHA1(user+ukey+stime)） */
    private async sendFeie(user: string, ukey: string, sn: string, content: string, times: number) {
        const stime = String(Math.floor(Date.now() / 1000));
        const sig = createHash('sha1').update(`${user}${ukey}${stime}`).digest('hex');
        const body = new URLSearchParams({
            user,
            ukey,
            stime,
            sig,
            apiname: 'Open_printMsg',
            sn,
            content,
            times: String(times),
        });
        const json: any = await this.postForm(FEIE_ENDPOINT, body);
        // 飞鹅成功返回 ret=0；非 0 时 msg 即失败原因（设备离线/编号不存在/密钥错等）
        if (Number(json?.ret) !== 0) throw new Error(`飞鹅打印失败：${json?.msg ?? '未知返回'}`);
    }

    /** 易联云：oauth 取 token → print/index（sign=MD5(client_id+timestamp+client_secret)） */
    private async sendYilianyun(clientId: string, clientSecret: string, machineCode: string, content: string) {
        const token = await this.yilianToken(clientId, clientSecret);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const sign = createHash('md5').update(`${clientId}${timestamp}${clientSecret}`).digest('hex');
        const body = new URLSearchParams({
            client_id: clientId,
            access_token: token,
            machine_code: machineCode,
            content,
            origin_id: `campus-${Date.now()}`,
            sign,
            timestamp,
            id: randomUUID(),
        });
        const json: any = await this.postForm(YLY_PRINT_ENDPOINT, body);
        if (Number(json?.error) !== 0) throw new Error(`易联云打印失败：${json?.error_description ?? '未知返回'}`);
    }

    private async yilianToken(clientId: string, clientSecret: string): Promise<string> {
        const cached = this.ylyTokens.get(clientId);
        if (cached && cached.expiresAt > Date.now()) return cached.token;
        const timestamp = String(Math.floor(Date.now() / 1000));
        const sign = createHash('md5').update(`${clientId}${timestamp}${clientSecret}`).digest('hex');
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            scope: 'all',
            client_id: clientId,
            timestamp,
            sign,
            id: randomUUID(),
        });
        const json: any = await this.postForm(YLY_OAUTH_ENDPOINT, body);
        const token = json?.body?.access_token;
        if (Number(json?.error) !== 0 || !token) {
            throw new Error(`易联云取 token 失败：${json?.error_description ?? '未知返回'}`);
        }
        const expiresIn = Number(json?.body?.expires_in ?? 2592000) * 1000;
        this.ylyTokens.set(clientId, { token, expiresAt: Date.now() + Math.max(expiresIn - 5 * 60 * 1000, 60_000) });
        return token;
    }

    /** 带超时的表单 POST：服务商接口不可用时最多阻塞 8s，避免拖慢接单 */
    private async postForm(url: string, body: URLSearchParams): Promise<any> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch {
                throw new Error(`返回非 JSON：${text.slice(0, 120)}`);
            }
        } catch (e: any) {
            if (e?.name === 'AbortError') throw new Error('打印服务商接口超时（8s）');
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }
}
