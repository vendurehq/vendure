"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginRateLimit = loginRateLimit;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const attempts = new Map();
const LOGIN_MUTATION_RE = /\b(login|authenticate)\s*\(/i;
function resolveIp(req) {
    var _a;
    return req.ip || ((_a = req.socket) === null || _a === void 0 ? void 0 : _a.remoteAddress) || 'unknown';
}
function resolveIdentifier(query, body) {
    var _a, _b, _c, _d, _e, _f, _g;
    const variables = (_a = body === null || body === void 0 ? void 0 : body.variables) !== null && _a !== void 0 ? _a : {};
    const argMatch = /(?:username|identifier|emailAddress|phoneNumber)\s*:\s*(?:"([^"]*)"|\$(\w+))/i.exec(query);
    if (argMatch) {
        const value = argMatch[1] !== undefined ? argMatch[1] : variables === null || variables === void 0 ? void 0 : variables[argMatch[2]];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim().toLowerCase();
        }
    }
    let value = (_d = (_c = (_b = variables.username) !== null && _b !== void 0 ? _b : variables.identifier) !== null && _c !== void 0 ? _c : variables.emailAddress) !== null && _d !== void 0 ? _d : variables.phoneNumber;
    if (!value && variables.input && typeof variables.input === 'object') {
        const first = Object.values(variables.input)[0];
        value = (_g = (_f = (_e = first === null || first === void 0 ? void 0 : first.username) !== null && _e !== void 0 ? _e : first === null || first === void 0 ? void 0 : first.identifier) !== null && _f !== void 0 ? _f : first === null || first === void 0 ? void 0 : first.emailAddress) !== null && _g !== void 0 ? _g : first === null || first === void 0 ? void 0 : first.phoneNumber;
    }
    const normalized = String(value !== null && value !== void 0 ? value : '').trim().toLowerCase();
    return normalized || 'anonymous';
}
function buildKey(req, query, body) {
    return `${resolveIp(req)}|${resolveIdentifier(query, body)}`;
}
function inspectLoginResult(payload) {
    var _a, _b, _c;
    let parsed = payload;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        }
        catch (_d) {
            return 'unknown';
        }
    }
    const login = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.data) === null || _a === void 0 ? void 0 : _a.login;
    if (login && typeof login === 'object') {
        const errorCode = login.errorCode;
        if (typeof errorCode === 'string') {
            return errorCode === 'INVALID_CREDENTIALS_ERROR' ? 'failure' : 'unknown';
        }
        return 'success';
    }
    const errors = parsed === null || parsed === void 0 ? void 0 : parsed.errors;
    if (Array.isArray(errors) && errors.length) {
        const first = errors[0];
        const code = (_b = first === null || first === void 0 ? void 0 : first.extensions) === null || _b === void 0 ? void 0 : _b.code;
        const message = String((_c = first === null || first === void 0 ? void 0 : first.message) !== null && _c !== void 0 ? _c : '');
        if (code === 'INVALID_CREDENTIALS' || /invalid credentials|用户名或密码/i.test(message)) {
            return 'failure';
        }
    }
    return 'unknown';
}
function recordFailure(key) {
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
function pruneExpired(now) {
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
function sendRateLimited(res, remainingMs) {
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
function loginRateLimit(req, res, next) {
    if (req.method !== 'POST') {
        return next();
    }
    const body = req.body;
    const query = typeof (body === null || body === void 0 ? void 0 : body.query) === 'string' ? body.query : '';
    if (!LOGIN_MUTATION_RE.test(query)) {
        return next();
    }
    const now = Date.now();
    pruneExpired(now);
    const key = buildKey(req, query, body);
    const record = attempts.get(key);
    if (record && record.blockedUntil > now) {
        sendRateLimited(res, record.blockedUntil - now);
        return;
    }
    let inspected = false;
    const handleResult = (payload) => {
        if (inspected) {
            return;
        }
        inspected = true;
        const result = inspectLoginResult(payload);
        if (result === 'failure') {
            recordFailure(key);
        }
        else if (result === 'success') {
            attempts.delete(key);
        }
    };
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalEnd = res.end.bind(res);
    res.json = ((payload) => {
        handleResult(payload);
        return originalJson(payload);
    });
    res.send = ((payload) => {
        handleResult(payload);
        return originalSend(payload);
    });
    res.end = ((chunk, ...args) => {
        handleResult(chunk);
        return originalEnd(chunk, ...args);
    });
    return next();
}
