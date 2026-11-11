import {
    Inject,
    MiddlewareConsumer,
    NestModule,
    OnApplicationBootstrap,
    OnApplicationShutdown,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    EventBus,
    Injector,
    Logger,
    PluginCommonModule,
    ProcessContext,
    registerPluginStartupMessage,
    Type,
    VendurePlugin,
} from '@vendure/core';
import { gql } from 'graphql-tag';

import { emailAdminApiExtensions, EmailAdminResolver } from './api/email-admin.resolver';
import { adminApiExtensions, OrderEmailResolver } from './api/order-email.resolver';
import { OrderEmailService } from './api/order-email.service';
import { getDevModeProductionWarning, isDevModeOptions, resolveTransportSettings } from './common';
import { EMAIL_OPTIONS, loggerCtx } from './constants';
import { EmailDefinition } from './define-email';
import { DevEmailApi } from './dev/dev-email-api';
import { DevOutbox, getDevOutboxDir } from './dev/dev-outbox';
import { EmailContentService } from './email-content.service';
import { EmailDesignService } from './email-design.service';
import { EmailPreviewService } from './email-preview.service';
import { EmailProcessor } from './email-processor';
import { EmailRenderService } from './email-render.service';
import { EmailService } from './email.service';
import { EmailContentOverride } from './entities/email-content-override.entity';
import { EmailDesignOverride } from './entities/email-design-override.entity';
import {
    EmailPluginDevModeOptions,
    EmailPluginOptions,
    EventWithContext,
    InitializedEmailPluginOptions,
} from './types';

/**
 * @description
 * Sends transactional emails when Vendure events happen. Each email is an {@link EmailDefinition}
 * with a React template, rendered with [React Email](https://react.email/) and sent with
 * [Nodemailer](https://nodemailer.com/).
 *
 * It also adds an Emails block to the order detail page of the Dashboard, from which order emails
 * can be previewed and sent by hand when the order's state allows it.
 *
 * @example
 * ```ts
 * import { defaultEmails, EmailPlugin } from '\@vendure/email';
 *
 * EmailPlugin.init({
 *     emails: defaultEmails,
 *     defaultFrom: '"My Shop" <noreply@myshop.com>',
 *     globalTemplateVars: {
 *         branding: { name: 'My Shop', primaryColor: '#0b7285' },
 *         verifyEmailAddressUrl: 'https://myshop.com/verify',
 *         passwordResetUrl: 'https://myshop.com/password-reset',
 *         changeEmailAddressUrl: 'https://myshop.com/verify-email-address-change',
 *         adminPasswordResetUrl: 'https://myshop.com/dashboard/reset-password',
 *     },
 *     transport: { type: 'smtp', host: 'smtp.example.com', port: 587 },
 * });
 * ```
 *
 * In development, use `devMode: true` with an `outputPath` and a `route` instead of `transport`.
 * Emails are then written to disk and listed in the outbox on the Dashboard's Emails page
 * (System > Emails). The `vendure email` CLI talks to the endpoints at the route.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: EMAIL_OPTIONS, useFactory: () => EmailPlugin.options },
        EmailProcessor,
        EmailRenderService,
        EmailService,
        EmailPreviewService,
        EmailContentService,
        EmailDesignService,
        OrderEmailService,
    ],
    entities: [EmailContentOverride, EmailDesignOverride],
    exports: [
        EmailRenderService,
        EmailService,
        EmailPreviewService,
        EmailContentService,
        EmailDesignService,
        OrderEmailService,
    ],
    adminApiExtensions: {
        schema: gql`
            ${adminApiExtensions}
            ${emailAdminApiExtensions}
        `,
        resolvers: [OrderEmailResolver, EmailAdminResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    configuration: config => {
        const hasLegacyPlugin = config.plugins.some(
            p => p !== EmailPlugin && (p as any).name === 'EmailPlugin',
        );
        if (hasLegacyPlugin) {
            throw new Error(
                'Both @vendure/email and @vendure/email-plugin are configured, so every email would be sent twice. ' +
                    'Remove EmailPlugin from @vendure/email-plugin.',
            );
        }
        return config;
    },
    compatibility: '^3.0.0',
})
export class EmailPlugin implements OnApplicationBootstrap, OnApplicationShutdown, NestModule {
    private static options: InitializedEmailPluginOptions;

    constructor(
        private readonly eventBus: EventBus,
        private readonly moduleRef: ModuleRef,
        private readonly emailProcessor: EmailProcessor,
        private readonly emailService: EmailService,
        private readonly previewService: EmailPreviewService,
        private readonly processContext: ProcessContext,
        @Inject(EMAIL_OPTIONS) private readonly options: InitializedEmailPluginOptions,
    ) {}

    static init(options: EmailPluginOptions | EmailPluginDevModeOptions): Type<EmailPlugin> {
        const types = new Set<string>();
        for (const email of options.emails) {
            if (types.has(email.type)) {
                throw new Error(`Two emails have the type "${email.type}". Email types must be unique.`);
            }
            types.add(email.type);
        }
        this.options = {
            ...options,
            templateLoaders: toArray(options.templateLoader),
        };
        return EmailPlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        const injector = new Injector(this.moduleRef);
        await this.options.emailSender?.init?.(injector);
        await this.emailProcessor.init();
        const transport = isDevModeOptions(this.options)
            ? undefined
            : await resolveTransportSettings(this.options, injector);
        // The testing transport sends directly, without the job queue, so tests see emails at once.
        if (transport?.type === 'testing') {
            this.emailService.sendDirectly(this.emailProcessor);
        } else {
            await this.emailService.useJobQueue(this.emailProcessor);
        }
        for (const email of this.options.emails) {
            this.eventBus
                .ofType(email.event)
                .subscribe(event => this.handleEvent(email, event as EventWithContext));
        }
    }

    async onApplicationShutdown() {
        await this.options.emailSender?.destroy?.();
    }

    configure(consumer: MiddlewareConsumer) {
        if (isDevModeOptions(this.options) && this.processContext.isServer) {
            const warning = getDevModeProductionWarning(this.options);
            if (warning) {
                Logger.warn(warning, loggerCtx);
            }
            const devApi = new DevEmailApi({
                emailService: this.emailService,
                previewService: this.previewService,
                outbox: new DevOutbox(getDevOutboxDir(this.options.outputPath)),
            });
            consumer.apply(devApi.router()).forRoutes(this.options.route);
            registerPluginStartupMessage('Email dev API', this.options.route);
        }
    }

    private async handleEvent(email: EmailDefinition<any, any>, event: EventWithContext) {
        try {
            const result = await this.emailService.prepare(email, event);
            if (result.status === 'ready') {
                await this.emailService.enqueue(result.job);
            } else if (result.status === 'failed') {
                const err = result.error;
                Logger.error(
                    `Could not prepare the "${email.type}" email (${result.stage}): ${err instanceof Error ? err.message : String(err)}`,
                    loggerCtx,
                    err instanceof Error ? err.stack : undefined,
                );
            }
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
        }
    }
}

function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
