import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Channel, RequestContext } from '@vendure/core';
import { Request, Router } from 'express';
import fs from 'fs-extra';
import path from 'path';

import { EmailEventHandler } from './handler/event-handler';
import { EmailPluginDevModeOptions, EventWithContext } from './types';

/**
 * An email inbox application that serves the contents of the dev mode `outputPath` directory.
 */
export class DevMailbox {
    private handleMockEventFn: (
        handler: EmailEventHandler<string, any>,
        event: EventWithContext,
    ) => void | undefined;

    serve(options: EmailPluginDevModeOptions): Router {
        const { outputPath, handlers } = options;
        const server = Router();
        server.get('/', (req, res) => {
            res.sendFile('dev-mailbox.html', { root: path.join(__dirname, '../..') });
        });
        server.get('/list', async (req, res) => {
            const list = await fs.readdir(outputPath);
            const contents = await this.getEmailList(outputPath);
            res.send(contents);
        });
        server.get('/types', async (req, res) => {
            res.send(handlers.map(h => h.type));
        });
        server.get('/generate/:type/:languageCode', async (req, res) => {
            const { type, languageCode } = req.params;
            if (this.handleMockEventFn) {
                const handler = handlers.find(h => h.type === type);
                if (!handler || !handler.mockEvent) {
                    res.statusCode = 404;
                    res.send({ success: false, error: `No mock event registered for type "${type}"` });
                    return;
                }
                try {
                    this.handleMockEventFn(handler, {
                        ...handler.mockEvent,
                        ctx: this.createRequestContext(languageCode as LanguageCode, req),
                    } as EventWithContext);
                    res.send({ success: true });
                } catch (e: any) {
                    res.statusCode = 500;
                    res.send({ success: false, error: e.message });
                }
                return;
            } else {
                res.send({ success: false, error: 'Mock email generation not set up.' });
            }
        });
        server.get('/item/:id', async (req, res) => {
            const fileName = req.params.id;
            const content = await this.getEmail(outputPath, fileName);
            res.send(content);
        });
        server.get('/placeholder-image', async (req, res) => {
            const img = Buffer.from(
                // eslint-disable-next-line max-len
                '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iJnfaemDXGV6R400ttQ0vzI8mSE7to7jvXnFACUUUUDCu++H27+zp8/d8zj8q4NVLsFUZJOAK9R8M6a2l6TFFJ/rG+ZvbPOKBMb4r/5AN1/u15dXo3jm8Fvo/lZw0rYH0HWvOaAQUUUUDCvU/Cv/ACL9l/uf1NeWV6n4V/5F+y/3P6mgTNWiiigkKKKKACiiigAooooAKKKKACiiigDnfHn/ACAf+2q/1rzmvRvHn/IB/wC2q/1rzmgpBRRRQMK6XwXrQ0+8NvKwEM3dj0Nc1SgkHI4NAHs/DDB5FcVr3ghy0lxYndk7jD/hS+GfGQAW2v2wBwsx/ka7KORJlDIwdT0KnNBOx5BcWNxasVmheNh2YU+1026vGCwwPIf9kV69tHpRgelAXOS8N+DvsrLc3oDSD7sfYe9dazBVJJwB1qOe4jtoy8rrGo7sa4bxN4u+3BrazYrD0aTpu/8ArUBuZ/irWjq2oELxDF8qjPU9zWJRRQUFFFFABXqfhX/kX7L/AHP6mvLK9T8K/wDIv2X+5/U0CZq0UUUEhRRRQAUUUUAFFFFABRRRQAUUUUAYHjiMyaC2P4XVj+tebV7BqFmmoWcsD9HGK8o1Cxl026kgmXDKcZ7H3FBSK1FFFAwooooAKuWerXmnsDBcPHjoucj8jVOigDpY/HmoR7dyxyY67h1ps3jrUZFYL5cZPQqOn51zlFAizdajc3rEzzvJnsTx+VVqKKBhRRRQAUUUUAFeq+GY2i0GzVhhgnT8TXnWh6TJq9/HCo+TOXbsBXqsMSwQpGowqjAoEx9FFFBIUUUUAFFFFABRRRQAUUUUAFFFFABVHVtFttYhCTplh91x1FXqKAOIuPh5Lu/cXSbf+mgP9Ki/4V5d/wDP1D+R/wAK7yigdzg/+FeXf/P1D+R/wo/4V5d/8/UP5H/Cu8ooC5wf/CvLv/n6h/I/4Uf8K8u/+fqH8j/hXeUUBc4P/hXl3/z9Q/kf8KP+FeXf/P1D+R/wrvKKAucH/wAK8u/+fqH8j/hR/wAK8u/+fqH8j/hXeUUBc4P/AIV5d/8AP1D+R/wo/wCFeXf/AD9Q/kf8K7yigLnB/wDCvLv/AJ+ofyP+FWLX4ekMDc3KkZ6Rg12lFAXKmm6VbaVD5dvGEB6nuat0UUCCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9k=',
                'base64',
            );

            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': img.length,
            });
            res.end(img);
        });

        return server;
    }

    handleMockEvent(handler: (handler: EmailEventHandler<string, any>, event: EventWithContext) => void) {
        this.handleMockEventFn = handler;
    }

    private async getEmailList(outputPath: string) {
        const list = await fs.readdir(outputPath);
        const contents: Array<{
            fileName: string;
            date: string;
            subject: string;
            recipient: string;
        }> = [];
        for (const fileName of list.filter(name => name.endsWith('.json'))) {
            const json = await fs.readFile(path.join(outputPath, fileName), 'utf-8');
            const content = JSON.parse(json);
            contents.push({
                fileName,
                date: content.date,
                subject: content.subject,
                recipient: content.recipient,
            });
        }
        contents.sort((a, b) => {
            return a.fileName < b.fileName ? 1 : -1;
        });
        return contents;
    }

    private async getEmail(outputPath: string, fileName: string) {
        const safeSuffix = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
        const safeFilePath = path.join(outputPath, safeSuffix);
        const json = await fs.readFile(safeFilePath, 'utf-8');
        const content = JSON.parse(json);
        return content;
    }

    private createRequestContext(languageCode: LanguageCode, req: Request): RequestContext {
        return new RequestContext({
            languageCode,
            req,
            apiType: 'admin',
            session: {} as any,
            isAuthorized: false,
            authorizedAsOwnerOnly: true,
            channel: new Channel(),
        });
    }
}
