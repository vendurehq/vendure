import { assertType, describe, it } from 'vitest';

import { SMTPTransportOptions } from './types';

// https://github.com/vendurehq/vendure/issues/4602
// Nodemailer pooled SMTP options (pool, maxConnections, ...) work at runtime because the
// transport object is forwarded directly to nodemailer.createTransport(), but they were
// missing from SMTPTransportOptions. These type-level tests fail to compile on master.
describe('SMTPTransportOptions pooled SMTP options (#4602)', () => {
    it('accepts Nodemailer pooled SMTP options', () => {
        assertType<SMTPTransportOptions>({
            type: 'smtp',
            host: 'smtp.example.com',
            port: 587,
            pool: true,
            maxConnections: 1,
            maxMessages: 100,
            rateDelta: 1000,
            rateLimit: 5,
            auth: { user: 'user', pass: 'pass' },
        });
    });

    it('still accepts a plain (non-pooled) SMTP config', () => {
        assertType<SMTPTransportOptions>({
            type: 'smtp',
            host: 'smtp.example.com',
            port: 587,
            auth: { user: 'user', pass: 'pass' },
        });
    });
});
