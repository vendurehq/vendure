import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailDetails, SESTransportOptions, SMTPTransportOptions } from '../types';

import { NodemailerEmailSender } from './nodemailer-email-sender';

const email: EmailDetails = {
    from: 'shop@example.com',
    recipient: 'customer@example.com',
    subject: 'Hello',
    body: '<p>Hello</p>',
    attachments: [],
};

class FakeSendEmailCommand {
    constructor(public input: any) {}
}

// AWS SDK v3 clients hold circular references, so JSON.stringify throws on SES transport options.
function createSesClient(region: string) {
    const client: any = {
        config: { region },
        send: vi.fn().mockResolvedValue({ MessageId: `${region}-id` }),
    };
    client.config.client = client;
    return client;
}

function sesConfig(sesClient: any): SESTransportOptions {
    return { type: 'ses', SES: { sesClient, SendEmailCommand: FakeSendEmailCommand } } as any;
}

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
        const sender = new NodemailerEmailSender() as any;
        const firstOptions: any = { type: 'smtp', host: 'a' };
        firstOptions.self = firstOptions;
        const secondOptions: any = { type: 'smtp', host: 'b' };
        secondOptions.self = secondOptions;

        const firstTransport = sender.getSmtpTransport(firstOptions);
        const secondTransport = sender.getSmtpTransport(secondOptions);

        expect(secondTransport).not.toBe(firstTransport);
        expect(secondTransport.options.host).toBe('b');
    });

    // #3265 - per-channel transport configs must not reuse the first transport
    it('uses the SMTP transport of each channel', async () => {
        const sender = new NodemailerEmailSender();
        const usedHosts: string[] = [];
        vi.spyOn(sender as any, 'sendMail').mockImplementation((_email: any, transport: any) => {
            usedHosts.push(transport.options.host);
            return Promise.resolve();
        });
        const channelConfig = (host: string): SMTPTransportOptions => ({ type: 'smtp', host, port: 587 });

        await sender.send(email, channelConfig('smtp.vendor-a.com'));
        await sender.send(email, channelConfig('smtp.vendor-b.com'));
        await sender.send(email, channelConfig('smtp.vendor-a.com'));

        expect(usedHosts).toEqual(['smtp.vendor-a.com', 'smtp.vendor-b.com', 'smtp.vendor-a.com']);
    });

    // #3265
    it('uses the SES client of each channel', async () => {
        const sender = new NodemailerEmailSender();
        const vendorAClient = createSesClient('eu-west-1');
        const vendorBClient = createSesClient('us-east-1');

        await sender.send(email, sesConfig(vendorAClient));
        await sender.send(email, sesConfig(vendorBClient));

        expect(vendorAClient.send).toHaveBeenCalledTimes(1);
        expect(vendorBClient.send).toHaveBeenCalledTimes(1);
    });

    it('reuses the SES transport for the same options object', async () => {
        const sender = new NodemailerEmailSender();
        const sendMail = vi.spyOn(sender as any, 'sendMail');
        const options = sesConfig(createSesClient('eu-west-1'));

        await sender.send(email, options);
        await sender.send(email, options);

        expect(sendMail.mock.calls[1][1]).toBe(sendMail.mock.calls[0][1]);
    });

    // https://github.com/vendurehq/vendure/issues/5571
    it('writes the raw message to a .txt file with the file transport', async () => {
        const outputPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-email-raw-'));
        try {
            await new NodemailerEmailSender().send(email, { type: 'file', outputPath, raw: true });

            const files = await fs.readdir(outputPath);
            expect(files).toHaveLength(1);
            expect(files[0]).toMatch(/\.txt$/);
            const content = await fs.readFile(path.join(outputPath, files[0]), 'utf-8');
            expect(content).toContain('Subject: Hello');
            expect(content).toContain('To: customer@example.com');
        } finally {
            await fs.remove(outputPath);
        }
    });

    it('rejects when the raw message cannot be written', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-email-raw-'));
        const outputPath = path.join(root, 'missing');
        try {
            await expect(
                new NodemailerEmailSender().send(email, { type: 'file', outputPath, raw: true }),
            ).rejects.toThrow(/ENOENT/);
        } finally {
            await fs.remove(root);
        }
    });
});
