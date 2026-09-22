import { Logger } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodemailerEmailSender } from './nodemailer-email-sender';

describe('NodemailerEmailSender', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reuses the SMTP transport for unchanged serializable options', () => {
        const sender = new NodemailerEmailSender() as any;
        const options = { type: 'smtp', host: 'a' };

        const firstTransport = sender.getSmtpTransport(options);
        const secondTransport = sender.getSmtpTransport(options);

        expect(secondTransport).toBe(firstTransport);
    });

    it('recreates the SMTP transport for different serializable options', () => {
        const sender = new NodemailerEmailSender() as any;

        const firstTransport = sender.getSmtpTransport({ type: 'smtp', host: 'a' });
        const secondTransport = sender.getSmtpTransport({ type: 'smtp', host: 'b' });

        expect(secondTransport).not.toBe(firstTransport);
    });

    it('recreates the SMTP transport when circular options cannot be compared', () => {
        vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        const sender = new NodemailerEmailSender() as any;
        const firstOptions: any = { type: 'smtp', host: 'a' };
        firstOptions.self = firstOptions;
        const secondOptions: any = { type: 'smtp', host: 'b' };
        secondOptions.self = secondOptions;

        const firstTransport = sender.getSmtpTransport(firstOptions);
        const secondTransport = sender.getSmtpTransport(secondOptions);

        expect(secondTransport).not.toBe(firstTransport);
    });
});
