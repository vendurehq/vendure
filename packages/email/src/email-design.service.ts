import { Injectable } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { IsNull } from 'typeorm';

import { EmailDesign, mergeEmailDesigns, validateEmailDesign } from './components/design';
import { EmailContentScope } from './email-content.service';
import { EmailDesignOverride } from './entities/email-design-override.entity';

/**
 * @description
 * Where each design setting of a rendered email came from: an unsaved `draft`, the `channel`'s
 * design, the design for `all-channels`, or the code (`default`).
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailDesign
 * @since 4.0.0
 */
export type EmailDesignOrigin = 'draft' | 'channel' | 'all-channels' | 'default';

/**
 * @description
 * Reads and stores the design of all emails that admins set in the Dashboard. Rendering uses
 * `resolve()`; the Dashboard uses the rest.
 *
 * @docsCategory core plugins/Email
 * @docsPage EmailDesign
 * @since 4.0.0
 */
@Injectable()
export class EmailDesignService {
    constructor(private readonly connection: TransactionalConnection) {}

    /**
     * @description
     * The design for the context's channel: its own settings, then the all-channels settings, with
     * an unsaved draft on top. Settings that none of them set are left out, so the code applies.
     */
    async resolve(
        ctx: RequestContext,
        draft?: EmailDesign,
    ): Promise<{ design: EmailDesign; origins: Partial<Record<keyof EmailDesign, EmailDesignOrigin>> }> {
        const rows = await this.connection.getRepository(ctx, EmailDesignOverride).find({
            where: [{ channelId: ctx.channelId }, { channelId: IsNull() }],
        });
        const allChannels = rows.find(r => r.channelId == null)?.design;
        const channel = rows.find(r => r.channelId != null)?.design;
        const layers: Array<[EmailDesignOrigin, EmailDesign | undefined]> = [
            ['all-channels', allChannels],
            ['channel', channel],
            ['draft', draft],
        ];
        const origins: Partial<Record<keyof EmailDesign, EmailDesignOrigin>> = {};
        for (const [origin, layer] of layers) {
            for (const name of Object.keys(mergeEmailDesigns(layer)) as Array<keyof EmailDesign>) {
                origins[name] = origin;
            }
        }
        return { design: mergeEmailDesigns(allChannels, channel, draft), origins };
    }

    async getStored(ctx: RequestContext, scope: EmailContentScope): Promise<EmailDesign> {
        const row = await this.findRow(ctx, this.channelIdFor(ctx, scope));
        return row?.design ?? {};
    }

    /**
     * @description
     * Stores the given settings. A null or empty value removes a setting, so it falls back to the
     * all-channels design or the code. Settings not in `design` are left as they are.
     */
    async update(
        ctx: RequestContext,
        scope: EmailContentScope,
        design: Record<string, unknown>,
    ): Promise<EmailDesign> {
        const problems = validateEmailDesign(design);
        if (problems.length) {
            throw new UserInputError(problems.join('\n'));
        }
        const channelId = this.channelIdFor(ctx, scope);
        const repository = this.connection.getRepository(ctx, EmailDesignOverride);
        const existing = await this.findRow(ctx, channelId);
        const merged: Record<string, unknown> = { ...existing?.design };
        for (const [name, value] of Object.entries(design)) {
            if (value == null || value === '') {
                delete merged[name];
            } else {
                merged[name] = value;
            }
        }
        if (!Object.keys(merged).length) {
            if (existing) {
                await repository.remove(existing);
            }
            return {};
        }
        if (existing) {
            existing.design = merged;
            await repository.save(existing);
        } else {
            await repository.save(new EmailDesignOverride({ channelId, design: merged }));
        }
        return merged;
    }

    private findRow(ctx: RequestContext, channelId: ID | null) {
        return this.connection.getRepository(ctx, EmailDesignOverride).findOne({
            where: { channelId: channelId ?? IsNull() },
        });
    }

    private channelIdFor(ctx: RequestContext, scope: EmailContentScope): ID | null {
        return scope === 'channel' ? ctx.channelId : null;
    }
}
