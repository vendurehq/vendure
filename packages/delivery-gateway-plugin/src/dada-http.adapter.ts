import { Logger } from '@vendure/core';
import { loggerCtx } from './constants';

/** 达达出站超时：与美团适配器保持一致（8s） */
const DADA_HTTP_TIMEOUT_MS = 8000;

/** 出站 HTTP 适配器抽象：测试可注入 fake，生产用 fetch 实现 */
export interface DadaHttpAdapter {
    post(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** 基于 fetch 的实现：POST application/json 到 baseUrl+path */
export class FetchDadaHttpAdapter implements DadaHttpAdapter {
    constructor(private readonly baseUrl: string) {}

    async post(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        const url = `${this.baseUrl}${path}`;
        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                signal: AbortSignal.timeout(DADA_HTTP_TIMEOUT_MS),
            });
        } catch (e: any) {
            const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
            Logger.warn(
                `达达 HTTP 请求失败 ${url}${timedOut ? `（超时 ${DADA_HTTP_TIMEOUT_MS}ms）` : ''}: ${e?.message ?? e}`,
                loggerCtx,
            );
            throw new Error(
                timedOut
                    ? `达达请求超时(${DADA_HTTP_TIMEOUT_MS}ms): ${url}`
                    : `达达请求失败: ${e?.message ?? e}`,
            );
        }
        if (!res.ok) {
            throw new Error(`达达 HTTP ${res.status}: ${url}`);
        }
        return (await res.json()) as Record<string, unknown>;
    }
}
