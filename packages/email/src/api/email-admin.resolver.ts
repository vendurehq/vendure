import { Inject } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, RequestContext, Transaction, UserInputError } from '@vendure/core';
import { Request } from 'express';
import { gql } from 'graphql-tag';

import { isDevModeOptions } from '../common';
import { EMAIL_OPTIONS } from '../constants';
import { DevOutbox, getDevOutboxDir } from '../dev/dev-outbox';
import { EmailContentScope, EmailContentService } from '../email-content.service';
import { EmailPreviewError, EmailPreviewService } from '../email-preview.service';
import { EmailRenderService } from '../email-render.service';
import { listEmailVariables } from '../template/email-content';
import { InitializedEmailPluginOptions } from '../types';

export const emailAdminApiExtensions = gql`
    type EmailInfo {
        type: String!
        label: String!
        event: String!
        hasSample: Boolean!
        canSendFromOrder: Boolean!
    }

    type EmailOverview {
        "True when the EmailPlugin runs in dev mode, so emails are written to the outbox instead of sent"
        devMode: Boolean!
        emails: [EmailInfo!]!
    }

    input EmailPreviewInput {
        type: String!
        languageCode: LanguageCode
        channelCode: String
        "Passed to the email's sample() function, e.g. { order: 'ABC123' }"
        sampleArgs: JSON
        "Unsaved text for content slots, by slot name. Shown instead of the stored text"
        content: JSON
    }

    type EmailPreview {
        type: String!
        languageCode: String!
        channelCode: String!
        recipient: String!
        from: String!
        subject: String!
        html: String!
        text: String!
        templateOrigin: String!
        "Where the text of each content slot came from: draft, channel, all-channels or default"
        contentOrigins: JSON!
    }

    enum EmailContentScope {
        "Text for the active channel only"
        CHANNEL
        "Text for all channels. A channel's own text takes precedence"
        ALL_CHANNELS
    }

    type EmailContentField {
        name: String!
        label: String!
        multiline: Boolean!
        "The template's default text"
        defaultValue: String!
        "The text stored for this scope, or null when the slot falls back"
        value: String
        "The text used when this scope has none: the all-channels text, or the default"
        fallbackValue: String!
    }

    type EmailContentVariable {
        name: String!
        label: String!
    }

    type EmailContent {
        type: String!
        languageCode: LanguageCode!
        scope: EmailContentScope!
        fields: [EmailContentField!]!
        variables: [EmailContentVariable!]!
    }

    input UpdateEmailContentInput {
        type: String!
        languageCode: LanguageCode!
        scope: EmailContentScope!
        "Text by slot name. An empty string removes the stored text, so the slot falls back"
        content: JSON!
    }

    type EmailOutboxEntry {
        id: String!
        sentAt: DateTime!
        status: String!
        type: String!
        recipient: String
        subject: String
        languageCode: String
        templateOrigin: String
        error: String
        html: String
        text: String
    }

    extend type Query {
        emailOverview: EmailOverview!
        "Renders an email from database data, without sending it"
        previewEmail(input: EmailPreviewInput!): EmailPreview!
        "Emails sent in dev mode, newest first. Empty when not in dev mode"
        emailOutbox(type: String, limit: Int): [EmailOutboxEntry!]!
        "The editable text of an email in one language, for the active channel or all channels"
        emailContent(type: String!, languageCode: LanguageCode!, scope: EmailContentScope!): EmailContent!
    }

    extend type Mutation {
        updateEmailContent(input: UpdateEmailContentInput!): EmailContent!
    }
`;

@Resolver()
export class EmailAdminResolver {
    private readonly outbox: DevOutbox | undefined;

    constructor(
        @Inject(EMAIL_OPTIONS) private readonly options: InitializedEmailPluginOptions,
        private readonly previewService: EmailPreviewService,
        private readonly contentService: EmailContentService,
        private readonly renderService: EmailRenderService,
    ) {
        if (isDevModeOptions(options)) {
            this.outbox = new DevOutbox(getDevOutboxDir(options.outputPath));
        }
    }

    @Query()
    @Allow(Permission.ReadSettings)
    emailOverview() {
        return { devMode: isDevModeOptions(this.options), emails: this.previewService.listEmails() };
    }

    @Query()
    @Allow(Permission.ReadSettings)
    async previewEmail(
        @Context('req') req: Request,
        @Args()
        args: {
            input: {
                type: string;
                languageCode?: string;
                channelCode?: string;
                sampleArgs?: Record<string, any>;
                content?: Record<string, any>;
            };
        },
    ) {
        const { type, languageCode, channelCode, sampleArgs, content } = args.input;
        try {
            const result = await this.previewService.render(
                { type, languageCode, channelCode, args: toStringRecord(sampleArgs), contentDraft: toStringRecord(content) },
                req,
            );
            return {
                type: result.type,
                languageCode: result.languageCode,
                channelCode: result.channelCode,
                ...result.email,
            };
        } catch (e: any) {
            if (e instanceof EmailPreviewError) {
                // The stage tells the admin (or agent) where to look.
                throw new UserInputError(`[${e.stage}] ${e.message}`);
            }
            throw e;
        }
    }

    @Query()
    @Allow(Permission.ReadSettings)
    async emailOutbox(@Args() args: { type?: string; limit?: number }) {
        if (!this.outbox) {
            return [];
        }
        const entries = await this.outbox.list({ type: args.type ?? undefined, limit: args.limit ?? 50 });
        return entries.map(e => ({ ...e, error: e.error?.message }));
    }

    @Query()
    @Allow(Permission.ReadSettings)
    emailContent(
        @Ctx() ctx: RequestContext,
        @Args() args: { type: string; languageCode: LanguageCode; scope: 'CHANNEL' | 'ALL_CHANNELS' },
    ) {
        return this.getContent(ctx, args.type, args.languageCode, toScope(args.scope));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings)
    async updateEmailContent(
        @Ctx() ctx: RequestContext,
        @Args()
        args: {
            input: {
                type: string;
                languageCode: LanguageCode;
                scope: 'CHANNEL' | 'ALL_CHANNELS';
                content: Record<string, any>;
            };
        },
    ) {
        const { type, languageCode, content } = args.input;
        const scope = toScope(args.input.scope);
        const template = await this.getTemplate(ctx, type, languageCode);
        const text: Record<string, string> = {};
        for (const [name, value] of Object.entries(content ?? {})) {
            text[name] = value == null ? '' : String(value);
        }
        await this.contentService.update(ctx, { type, languageCode, scope, content: text, template });
        return this.getContent(ctx, type, languageCode, scope);
    }

    private async getContent(ctx: RequestContext, type: string, languageCode: LanguageCode, scope: EmailContentScope) {
        const template = await this.getTemplate(ctx, type, languageCode);
        const stored = await this.contentService.getStored(ctx, type, languageCode, scope);
        const allChannels =
            scope === 'channel'
                ? await this.contentService.getStored(ctx, type, languageCode, 'all-channels')
                : {};
        return {
            type,
            languageCode,
            scope: scope === 'channel' ? 'CHANNEL' : 'ALL_CHANNELS',
            fields: Object.entries(template.content ?? {}).map(([name, slot]) => ({
                name,
                label: slot.label,
                multiline: !!slot.multiline,
                defaultValue: slot.default,
                value: stored[name] ?? null,
                fallbackValue: allChannels[name] ?? slot.default,
            })),
            variables: listEmailVariables(template),
        };
    }

    private async getTemplate(ctx: RequestContext, type: string, languageCode: LanguageCode) {
        try {
            const { template } = await this.renderService.resolveTemplate(ctx, {
                type,
                languageCode,
                channelCode: ctx.channel.code,
            });
            return template;
        } catch (e: any) {
            throw new UserInputError(String(e?.message ?? e));
        }
    }
}

function toScope(scope: 'CHANNEL' | 'ALL_CHANNELS'): EmailContentScope {
    return scope === 'CHANNEL' ? 'channel' : 'all-channels';
}

function toStringRecord(value: Record<string, any> | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, v] of Object.entries(value ?? {})) {
        if (v != null && v !== '') {
            result[key] = String(v);
        }
    }
    return result;
}
