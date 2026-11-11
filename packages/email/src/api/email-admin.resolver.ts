import { Inject } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, RequestContext, Transaction, UserInputError } from '@vendure/core';
import { Request } from 'express';
import { gql } from 'graphql-tag';

import { isDevModeOptions } from '../common';
import { emailTheme } from '../components/blocks';
import { defaultBranding } from '../components/branding';
import { EmailDesign, emailDesignFields, emailFontStacks, validateEmailDesign } from '../components/design';
import { EMAIL_OPTIONS } from '../constants';
import { DevOutbox, getDevOutboxDir } from '../dev/dev-outbox';
import { EmailContentScope, EmailContentService } from '../email-content.service';
import { EmailDesignService } from '../email-design.service';
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
        "Marks the editable text in the HTML and shows it with its {{ variables }}, for editing in the preview"
        editable: Boolean
        "Unsaved design settings. Shown instead of the stored design"
        design: JSON
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
        "Where each design setting set in the Dashboard came from: draft, channel or all-channels"
        designOrigins: JSON!
    }

    type EmailDesignField {
        name: String!
        label: String!
        "text, multiline, url, color, number, font or align"
        kind: String!
        "brand or layout"
        group: String!
        min: Int
        max: Int
    }

    type EmailFontOption {
        label: String!
        value: String!
    }

    type EmailDesignData {
        scope: EmailContentScope!
        "The settings stored for this scope"
        design: JSON!
        "The settings used when this scope has none: the all-channels design for a channel, or empty"
        fallback: JSON!
        "The values the email components use when nothing is set in the Dashboard"
        defaults: JSON!
        fields: [EmailDesignField!]!
        fonts: [EmailFontOption!]!
    }

    input UpdateEmailDesignInput {
        scope: EmailContentScope!
        "Settings by name. Null or an empty string removes a setting, so it falls back"
        design: JSON!
    }

    input SendTestEmailInput {
        type: String!
        languageCode: LanguageCode
        channelCode: String
        sampleArgs: JSON
        "Unsaved text for content slots"
        content: JSON
        "Unsaved design settings"
        design: JSON
        to: String!
    }

    type SendTestEmailResult {
        recipient: String!
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
        "The design of all emails, for the active channel or all channels"
        emailDesign(scope: EmailContentScope!): EmailDesignData!
    }

    extend type Mutation {
        updateEmailContent(input: UpdateEmailContentInput!): EmailContent!
        updateEmailDesign(input: UpdateEmailDesignInput!): EmailDesignData!
        "Sends an email built from sample data to an address, with unsaved text and design, through the configured transport"
        sendTestEmail(input: SendTestEmailInput!): SendTestEmailResult!
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
        private readonly designService: EmailDesignService,
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
                editable?: boolean;
                design?: Record<string, any>;
            };
        },
    ) {
        const { type, languageCode, channelCode, sampleArgs, content, editable } = args.input;
        try {
            const result = await this.previewService.render(
                {
                    type,
                    languageCode,
                    channelCode,
                    args: toStringRecord(sampleArgs),
                    contentDraft: toStringRecord(content),
                    designDraft: toDesignDraft(args.input.design) as EmailDesign | undefined,
                    editable: !!editable,
                },
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

    @Query()
    @Allow(Permission.ReadSettings)
    emailDesign(@Ctx() ctx: RequestContext, @Args() args: { scope: 'CHANNEL' | 'ALL_CHANNELS' }) {
        return this.getDesign(ctx, toScope(args.scope));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings)
    async updateEmailDesign(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { scope: 'CHANNEL' | 'ALL_CHANNELS'; design: Record<string, unknown> } },
    ) {
        const scope = toScope(args.input.scope);
        await this.designService.update(ctx, scope, args.input.design ?? {});
        return this.getDesign(ctx, scope);
    }

    @Mutation()
    @Allow(Permission.UpdateSettings)
    async sendTestEmail(
        @Context('req') req: Request,
        @Args()
        args: {
            input: {
                type: string;
                languageCode?: string;
                channelCode?: string;
                sampleArgs?: Record<string, any>;
                content?: Record<string, any>;
                design?: Record<string, any>;
                to: string;
            };
        },
    ) {
        const { type, languageCode, channelCode, sampleArgs, content, to } = args.input;
        if (!/^[^\s@]+@[^\s@]+$/.test(to?.trim() ?? '')) {
            throw new UserInputError(`"${to}" is not an email address`);
        }
        try {
            return await this.previewService.sendTest(
                {
                    type,
                    languageCode,
                    channelCode,
                    args: toStringRecord(sampleArgs),
                    contentDraft: toStringRecord(content),
                    designDraft: toDesignDraft(args.input.design) as EmailDesign | undefined,
                    to: to.trim(),
                },
                req,
            );
        } catch (e: any) {
            if (e instanceof EmailPreviewError) {
                throw new UserInputError(`[${e.stage}] ${e.message}`);
            }
            throw e;
        }
    }

    private async getDesign(ctx: RequestContext, scope: EmailContentScope) {
        const design = await this.designService.getStored(ctx, scope);
        const fallback = scope === 'channel' ? await this.designService.getStored(ctx, 'all-channels') : {};
        return {
            scope: scope === 'channel' ? 'CHANNEL' : 'ALL_CHANNELS',
            design,
            fallback,
            defaults: await this.designDefaults(ctx),
            fields: emailDesignFields,
            fonts: emailFontStacks,
        };
    }

    /** What the email components use without a Dashboard design: the `branding` variable, then the theme. */
    private async designDefaults(ctx: RequestContext) {
        const globals = await this.previewService.globalTemplateVars(ctx);
        const branding = (globals.branding ?? {}) as Record<string, unknown>;
        return {
            name: branding.name ?? '',
            logoUrl: branding.logoUrl ?? '',
            logoHeight: emailTheme.logoHeight,
            headerAlign: emailTheme.headerAlign,
            primaryColor: branding.primaryColor ?? defaultBranding.primaryColor,
            primaryTextColor: branding.primaryTextColor ?? defaultBranding.primaryTextColor,
            footerText: branding.footerText ?? '',
            fontFamily: emailTheme.fontFamily,
            pageBackground: emailTheme.pageBackground,
            cardBackground: emailTheme.cardBackground,
            cardRadius: Number.parseInt(emailTheme.radius, 10),
            buttonRadius: Number.parseInt(emailTheme.buttonRadius, 10),
        };
    }

    private async getContent(
        ctx: RequestContext,
        type: string,
        languageCode: LanguageCode,
        scope: EmailContentScope,
    ) {
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

function toDesignDraft(value: Record<string, any> | undefined) {
    if (!value) {
        return undefined;
    }
    const problems = validateEmailDesign(value);
    if (problems.length) {
        throw new UserInputError(problems.join('\n'));
    }
    return value;
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
