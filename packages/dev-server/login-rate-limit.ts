import type { NextFunction, Request, Response } from 'express';

/**
 * 登录失败限速（Phase1，进程内计数）
 *
 * 背景：Vendure 的 login/authenticate 是 GraphQL mutation，网关层无法按路径区分，
 * 因此在 API 中间件内按「IP + 账号」统计失败次数：15 分钟内连续失败 5 次后锁定 15 分钟。
 * 仅统计 INVALID_CREDENTIALS_ERROR（账号密码错误），验证码/未验证等其他错误不计数。
 * 代价：计数保存在单进程内存中，pm2 fork 单实例下有效；后续切 cluster 需改为 Redis。
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

interface AttemptRecord {
    failures: number;
    windowStart: number;
    blockedUntil: number;
}

const attempts = new Map<string, AttemptRecord>();

const LOGIN_MUTATION_RE = /\b(login|authenticate)\s*\(/i;

function resolveIp(req: Request): string {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function resolveIdentifier(body: any): string {
    const variables = body?.variables ?? {};
    let value =
        variables.username ?? variables.identifier ?? variables.emailAddress ?? variables.phoneNumber;
    // authenticate(input: { native: { username, password } })：取第一个认证方式里的账号
    if (!value && variables.input && typeof variables.input === 'object') {
        const first: any = Object.values(variables.input)[0];
        value = first?.username ?? first?.identifier ?? first?.emailAddress ?? first?.phoneNumber;
    }
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized || 'anonymous';
}

function buildKey(req: Request, body: any): string {
    return `${resolveIp(req)}|${resolveIdentifier(body)}`;
}

type InspectResult = 'success' | 'failure' | 'unknown';

function inspectLoginResult(payload: unknown): InspectResult {
    let parsed: any = payload;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return 'unknown';
        }
    }
    const login = parsed?.data?.login;
    if (login && typeof login === 'object') {
        const errorCode = (login as any).errorCode;
        if (typeof errorCode === 'string') {
            return errorCode === 'INVALID_CREDENTIALS_ERROR' ? 'failure' : 'unknown';
        }
        return 'success';
    }
    const errors = parsed?.errors;
    if (Array.isArray(errors) && errors.length) {
        const first: any = errors[0];
        const code = first?.extensions?.code;
        const message = String(first?.message ?? '');
        if (code === 'INVALID_CREDENTIALS' || /invalid credentials|用户名或密码/i.test(message)) {
            return 'failure';
        }
    }
    return 'unknown';
}

function recordFailure(key: string) {
    const now = Date.now();
    let record = attempts.get(key);
    if (!record || now - record.windowStart > WINDOW_MS) {
        record = { failures: 0, windowStart: now, blockedUntil: 0 };
    }
    record.failures += 1;
    if (record.failures >= MAX_FAILURES) {
        record.blockedUntil = now + WINDOW_MS;
    }
    attempts.set(key, record);
}

function pruneExpired(now: number) {
    if (attempts.size < 1000) {
        return;
    }
    for (const [key, record] of attempts) {
        if (record.blockedUntil > now) {
            continue;
        }
        if (now - record.windowStart > WINDOW_MS) {
            attempts.delete(key);
        }
    }
}

function sendRateLimited(res: Response, remainingMs: number) {
    const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
    res.status(200).json({
        data: null,
        errors: [
            {
                message: `登录尝试过于频繁，请 ${minutes} 分钟后再试`,
                extensions: {
                    code: 'LOGIN_RATE_LIMITED',
                    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
                },
            },
        ],
    });
}

export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
    if (req.method !== 'POST') {
        return next();
    }
    const body: any = (req as any).body;
    const query = typeof body?.query === 'string' ? body.query : '';
    if (!LOGIN_MUTATION_RE.test(query)) {
        return next();
    }

    const now = Date.now();
    pruneExpired(now);
    const key = buildKey(req, body);
    const record = attempts.get(key);
    if (record && record.blockedUntil > now) {
        sendRateLimited(res, record.blockedUntil - now);
        return;
    }

    // 检查 GraphQL 响应体判定成功/失败（login 返回 LoginResult union，失败时 data.login 带 errorCode）
    let inspected = false;
    const handleResult = (payload: unknown) => {
        if (inspected) {
            return;
        }
        inspected = true;
        const result = inspectLoginResult(payload);
        if (result === 'failure') {
            recordFailure(key);
        } else if (result === 'success') {
            attempts.delete(key);
        }
    };

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalEnd = res.end.bind(res);
    res.json = ((payload: any) => {
        handleResult(payload);
        return originalJson(payload);
    }) as Response['json'];
    res.send = ((payload: any) => {
        handleResult(payload);
        return originalSend(payload);
    }) as Response['send'];
    res.end = ((chunk?: any, ...args: any[]) => {
        handleResult(chunk);
        return (originalEnd as any)(chunk, ...args);
    }) as Response['end'];

    return next();
}
