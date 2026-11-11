import { Inject } from '@nestjs/common';
import { Args, Context, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { Allow, UserInputError } from '@vendure/core';
import { Request } from 'express';
import { gql } from 'graphql-tag';

import { isDevModeOptions } from '../common';
import { EMAIL_OPTIONS } from '../constants';
import { DevOutbox, getDevOutboxDir } from '../dev/dev-outbox';
import { EmailPreviewError, EmailPreviewService } from '../email-preview.service';
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
    }
`;

@Resolver()
export class EmailAdminResolver {
    private outbox: DevOutbox | undefined;

    constructor(
        @Inject(EMAIL_OPTIONS) private options: InitializedEmailPluginOptions,
        private previewService: EmailPreviewService,
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
        args: { input: { type: string; languageCode?: string; channelCode?: string; sampleArgs?: Record<string, any> } },
    ) {
        const { type, languageCode, channelCode, sampleArgs } = args.input;
        try {
            const result = await this.previewService.render(
                { type, languageCode, channelCode, args: toStringRecord(sampleArgs) },
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
