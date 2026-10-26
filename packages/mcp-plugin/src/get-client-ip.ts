import type { Request } from 'express';
import { isIP } from 'node:net';

export function getClientIp(req: Request): string | undefined {
    const value = req.ip ?? req.socket?.remoteAddress;
    return value != null && isIP(value) !== 0 ? value : undefined;
}
