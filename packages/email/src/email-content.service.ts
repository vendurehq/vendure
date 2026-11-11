import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { IsNull } from 'typeorm';

import { EmailContentOverride } from './entities/email-content-override.entity';
import { EmailContentOverrides, validateEmailContent } from './template/email-content';
import { EmailTemplate } from './template/email-template';

/**
 * @description
 * Whether stored text applies to the active channel only, or to all channels.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
export type EmailContentScope = 'channel' | 'all-channels';

/**
 * @description
 * Reads and stores the text that admins set for the content slots of an email. Rendering uses
 * {@link EmailContentService}.`getOverrides()`; the Dashboard uses the rest.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailContent
 * @since 4.0.0
 */
@Injectable()
export class EmailContentService {
    constructor(private readonly connection: TransactionalConnection) {}

    /**
     * @description
     * The overrides that apply to an email in a language, for the context's channel.
     */
    async getOverrides(ctx: RequestContext, type: string, languageCode: string): Promise<EmailContentOverrides> {
        const rows = await this.connection.getRepository(ctx, EmailContentOverride).find({
            where: [
                { type, languageCode: languageCode as LanguageCode, channelId: ctx.channelId },
                { type, languageCode: languageCode as LanguageCode, channelId: IsNull() },
            ],
        });
        return {
            channel: rows.find(r => r.channelId != null)?.content,
            allChannels: rows.find(r => r.channelId == null)?.content,
        };
    }

    async getStored(
        ctx: RequestContext,
        type: string,
        languageCode: LanguageCode,
        scope: EmailContentScope,
    ): Promise<Record<string, string>> {
        const row = await this.findRow(ctx, type, languageCode, this.channelIdFor(ctx, scope));
        return row?.content ?? {};
    }

    /**
     * @description
     * Stores the text of the given slots. An empty string removes a slot's override, so it uses the
     * default (or the all-channels text) again. Slots not in `content` are left as they are.
     */
    async update(
        ctx: RequestContext,
        input: {
            type: string;
            languageCode: LanguageCode;
            scope: EmailContentScope;
            content: Record<string, string>;
            template: EmailTemplate;
        },
    ): Promise<Record<string, string>> {
        const problems = validateEmailContent(input.template, input.content);
        if (problems.length) {
            throw new UserInputError(problems.join('\n'));
        }
        const channelId = this.channelIdFor(ctx, input.scope);
        const repository = this.connection.getRepository(ctx, EmailContentOverride);
        const existing = await this.findRow(ctx, input.type, input.languageCode, channelId);
        const merged: Record<string, string> = { ...existing?.content };
        for (const [name, text] of Object.entries(input.content)) {
            if (typeof text === 'string' && text.trim() !== '') {
                merged[name] = text;
            } else {
                delete merged[name];
            }
        }
        if (!Object.keys(merged).length) {
            if (existing) {
                await repository.remove(existing);
            }
            return {};
        }
        if (existing) {
            existing.content = merged;
            await repository.save(existing);
        } else {
            await repository.save(
                new EmailContentOverride({
                    type: input.type,
                    languageCode: input.languageCode,
                    channelId,
                    content: merged,
                }),
            );
        }
        return merged;
    }

    private findRow(ctx: RequestContext, type: string, languageCode: LanguageCode, channelId: ID | null) {
        return this.connection.getRepository(ctx, EmailContentOverride).findOne({
            where: { type, languageCode, channelId: channelId ?? IsNull() },
        });
    }

    private channelIdFor(ctx: RequestContext, scope: EmailContentScope): ID | null {
        return scope === 'channel' ? ctx.channelId : null;
    }
}
