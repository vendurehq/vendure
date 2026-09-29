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
});
