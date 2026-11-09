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
    JobQueue,
    JobQueueService,
    Logger,
    PluginCommonModule,
    ProcessContext,
    registerPluginStartupMessage,
    RequestContext,
    Type,
    VendurePlugin,
} from '@vendure/core';

import { getDevModeProductionWarning, isDevModeOptions, resolveTransportSettings } from './common';
import { EMAIL_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { DevMailbox } from './dev-mailbox';
import { DevEmailApi } from './dev/dev-email-api';
import { DevOutbox, getDevOutboxDir } from './dev/dev-outbox';
import { EmailProcessor } from './email-processor';
import { EmailRenderService } from './email-render.service';
import { HandlebarsMjmlGenerator } from './generator/handlebars-mjml-generator';
import { ReactEmailGenerator } from './generator/react-email-generator';
import { EmailEventHandler, EmailEventHandlerWithAsyncData } from './handler/event-handler';
import { FileBasedTemplateLoader } from './template-loader/file-based-template-loader';
import {
    EmailPluginDevModeOptions,
    EmailPluginOptions,
    EventWithContext,
    InitializedEmailPluginOptions,
    IntermediateEmailDetails,
} from './types';

/**
 * @description
 * The EmailPlugin creates and sends transactional emails based on Vendure events. It renders the emails from
 * React templates with [React Email](https://react.email/), and uses [Nodemailer](https://nodemailer.com/about/) to send them.
 *
 * ## High-level description
 * Vendure has an internal events system (see {@link EventBus}) that allows plugins to subscribe to events. The EmailPlugin is configured with {@link EmailEventHandler}s
 * that listen for a specific event and when it is published, the handler defines which template to use to generate the resulting email.
 *
 * The plugin comes with a set of default handler for the following events:
 * - Order confirmation
 * - New customer email address verification
 * - Password reset request
 * - Email address change request
 *
 * You can also create your own handler and register them with the plugin - see the {@link EmailEventHandler} docs for more details.
 *
 * ## Installation
 *
 * `yarn add \@vendure/email-plugin`
 *
 * or
 *
 * `npm install \@vendure/email-plugin`
 *
 * @example
 * ```ts
 * import { defaultEmailHandlers, EmailPlugin } from '\@vendure/email-plugin';
 *
 * const config: VendureConfig = {
 *   // Add an instance of the plugin to the plugins array
 *   plugins: [
 *     EmailPlugin.init({
 *       handlers: defaultEmailHandlers,
 *       globalTemplateVars: {
 *         fromAddress: '"My Shop" <noreply@myshop.com>',
 *         branding: { name: 'My Shop', logoUrl: 'https://myshop.com/logo.png' },
 *         // ...
 *       },
 *       transport: {
 *         type: 'smtp',
 *         host: 'smtp.example.com',
 *         port: 587,
 *         auth: {
 *           user: 'username',
 *           pass: 'password',
 *         }
 *       },
 *     }),
 *   ],
 * };
 * ```
 *
 * ## Email templates
 *
 * Each default handler comes with a React template, which you can style by setting the `branding` global
 * template variable (see {@link EmailBranding}).
 *
 * To change an email's content, write your own template with {@link defineEmailTemplate} and set it on the
 * handler with `.setTemplate()`. A template is a React component which receives the template variables as
 * its props. Build it from the email components exported by this package, such as {@link EmailLayout},
 * {@link EmailText}, {@link EmailButton} and {@link OrderSummary}, or from any React Email component:
 *
 * ```tsx
 * import { defineEmailTemplate, EmailLayout, EmailSection, EmailText, Money } from '\@vendure/email-plugin';
 *
 * export const MyOrderConfirmationEmail = defineEmailTemplate<{ order: EmailOrder; branding?: EmailBranding }>(
 *   ({ order, branding }) => (
 *     <EmailLayout title="Order Receipt" branding={branding}>
 *       <EmailSection>
 *         <EmailText>Thanks for your order {order.code}!</EmailText>
 *         <EmailText>Total: <Money value={order.totalWithTax} currencyCode={order.currencyCode} /></EmailText>
 *       </EmailSection>
 *     </EmailLayout>
 *   ),
 * );
 *
 * // In vendure-config.ts
 * EmailPlugin.init({
 *   handlers: [
 *     ...defaultEmailHandlers.filter(h => h !== orderConfirmationHandler),
 *     orderConfirmationHandler.setTemplate(MyOrderConfirmationEmail),
 *   ],
 *   // ...
 * })
 * ```
 *
 * The template variables pass through the job queue before the email is rendered, so the props are plain JSON
 * data: dates are ISO strings, and entity getters are plain properties.
 *
 * ### Loading templates at runtime
 *
 * Configure one or more {@link TemplateLoader}s to load templates from elsewhere, e.g. a database. For each
 * email, the first template returned by a loader is used, and the template set on the handler only if no
 * loader returns one.
 *
 * ### Handlebars/MJML templates
 *
 * Before v4, templates were Handlebars/MJML files loaded with the {@link FileBasedTemplateLoader}. These still
 * work if you install `handlebars` and `mjml`, but are deprecated. See the v4 migration guide.
 *
 * ### Setting global variables using `globalTemplateVars`
 *
 * `globalTemplateVars` is an object that can be passed to the configuration of the Email Plugin with static object variables.
 * You can also pass an async function that will be called with the `RequestContext` and the `Injector` so you can access services
 * and e.g. load channel specific theme configurations.
 *
 * @example
 * ```ts
 * EmailPlugin.init({
 *    globalTemplateVars: {
 *      primaryColor: '#FF0000',
 *      fromAddress: 'no-reply@ourstore.com'
 *    }
 * })
 * ```
 * or
 * ```ts
 * EmailPlugin.init({
 *    globalTemplateVars: async (ctx, injector) => {
 *      const myAsyncService = injector.get(MyAsyncService);
 *      const asyncValue = await myAsyncService.get(ctx);
 *      const channel = ctx.channel;
 *      const { primaryColor } = channel.customFields.theme;
 *      const theme = {
 *         primaryColor,
 *         asyncValue,
 *      };
 *      return theme;
 *    }
 * })
 * ```
 *
 * ### Formatting money and dates
 *
 * Use the {@link Money} and {@link FormattedDate} components, or the {@link formatMoney} and {@link formatDate}
 * functions. The components format in the language of the email.
 *
 * ## Extending the default email handler
 *
 * The `defaultEmailHandlers` array defines the default handler such as for handling new account registration, order confirmation, password reset
 * etc. These defaults can be extended by adding custom templates for languages other than the default, or even completely new types of emails
 * which respond to any of the available [VendureEvents](/reference/typescript-api/events/).
 *
 * A good way to learn how to create your own email handler is to take a look at the
 * [source code of the default handler](https://github.com/vendurehq/vendure/blob/master/packages/email-plugin/src/handler/default-email-handlers.ts).
 * New handler are defined in exactly the same way.
 *
 * It is also possible to modify the default handler:
 *
 * ```ts
 * // Rather than importing `defaultEmailHandlers`, you can
 * // import the handler individually
 * import {
 *   orderConfirmationHandler,
 *   emailVerificationHandler,
 *   passwordResetHandler,
 *   emailAddressChangeHandler,
 * } from '\@vendure/email-plugin';
 * import { CustomerService } from '\@vendure/core';
 *
 * // This allows you to then customize each handler to your needs.
 * // For example, let's set a new subject line to the order confirmation:
 * const myOrderConfirmationHandler = orderConfirmationHandler
 *   .setSubject(`We received your order!`);
 *
 * // Another example: loading additional data and setting new
 * // template variables.
 * const myPasswordResetHandler = passwordResetHandler
 *   .loadData(async ({ event, injector }) => {
 *     const customerService = injector.get(CustomerService);
 *     const customer = await customerService.findOneByUserId(event.ctx, event.user.id);
 *     return { customer };
 *   })
 *   .setTemplateVars(event => ({
 *     passwordResetToken: event.user.getNativeAuthenticationMethod().passwordResetToken,
 *     customer: event.data.customer,
 *   }));
 *
 * // Then you pass the handler to the EmailPlugin init method
 * // individually
 * EmailPlugin.init({
 *   handlers: [
 *     myOrderConfirmationHandler,
 *     myPasswordResetHandler,
 *     emailVerificationHandler,
 *     emailAddressChangeHandler,
 *   ],
 *   // ...
 * }),
 * ```
 *
 * For all available methods of extending a handler, see the {@link EmailEventHandler} documentation.
 *
 * ## Dynamic SMTP settings
 *
 * Instead of defining static transport settings, you can also provide a function that dynamically resolves
 * channel aware transport settings.
 *
 * @example
 * ```ts
 * import { defaultEmailHandlers, EmailPlugin } from '\@vendure/email-plugin';
 * import { MyTransportService } from './transport.services.ts';
 * const config: VendureConfig = {
 *   plugins: [
 *     EmailPlugin.init({
 *       handlers: defaultEmailHandlers,
 *       transport: (injector, ctx) => {
 *         if (ctx) {
 *           return injector.get(MyTransportService).getSettings(ctx);
 *         } else {
 *           return {
 *             type: 'smtp',
 *             host: 'smtp.example.com',
 *             // ... etc.
 *           }
 *         }
 *       }
 *     }),
 *   ],
 * };
 * ```
 *
 * ## Dev mode
 *
 * For development, the `transport` option can be replaced by `devMode: true`. Doing so configures Vendure to use the
 * file transport (See {@link FileTransportOptions}) and outputs emails as rendered HTML files in the directory specified by the
 * `outputPath` property. Every send attempt, including failures, is also recorded in a dev outbox.
 *
 * ```ts
 * EmailPlugin.init({
 *   devMode: true,
 *   route: 'mailbox',
 *   handlers: defaultEmailHandlers,
 *   outputPath: path.join(__dirname, 'test-emails'),
 * })
 * ```
 *
 * ### The `vendure email` commands
 *
 * In dev mode, the `vendure email` CLI commands render emails from the data in your database, send them through
 * the real pipeline, and show what was sent. They are built for coding agents as well as people: they print JSON
 * when not run in a terminal, and failures name the stage they happened at. Enable them by adding
 * `"\@vendure/email-plugin"` to `vendure.cli.plugins` in your package.json.
 *
 * ```
 * npx vendure email list
 * npx vendure email render order-confirmation --language de --arg order=XN4P3TQ8
 * npx vendure email send password-reset --to me@example.com
 * npx vendure email outbox --to customer@example.com --since 5m --wait 15
 * npx vendure email check --language en,de
 * ```
 *
 * Give your own handlers sample data for these commands with `EmailEventHandler.setSampleEvent()`.
 *
 * ### Dev mailbox
 *
 * In dev mode, a webmail-like interface available at the `/mailbox` path, e.g.
 * http://localhost:3000/mailbox. This is a simple way to view the output of all emails generated by the EmailPlugin while in dev mode.
 *
 * The dev mailbox has no authentication, and no emails are sent in dev mode, so only enable `devMode`
 * in local development. The plugin logs a warning at startup if `devMode` is enabled while
 * `NODE_ENV` is `production`.
 *
 * ## Troubleshooting SMTP Connections
 *
 * If you are having trouble sending email over and SMTP connection, set the `logging` and `debug` options to `true`. This will
 * send detailed information from the SMTP transporter to the configured logger (defaults to console). For maximum detail combine
 * this with a detail log level in the configured VendureLogger:
 *
 * ```ts
 * const config: VendureConfig = {
 *   logger: new DefaultLogger({ level: LogLevel.Debug })
 *   // ...
 *   plugins: [
 *     EmailPlugin.init({
 *       // ...
 *       transport: {
 *         type: 'smtp',
 *         host: 'smtp.example.com',
 *         port: 587,
 *         auth: {
 *           user: 'username',
 *           pass: 'password',
 *         },
 *         logging: true,
 *         debug: true,
 *       },
 *     }),
 *   ],
 * };
 * ```
 *
 * @docsCategory core plugins/EmailPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        { provide: EMAIL_PLUGIN_OPTIONS, useFactory: () => EmailPlugin.options },
        EmailProcessor,
        EmailRenderService,
    ],
    exports: [EmailRenderService],
    compatibility: '^3.0.0',
})
export class EmailPlugin implements OnApplicationBootstrap, OnApplicationShutdown, NestModule {
    private static options: InitializedEmailPluginOptions;
    private devMailbox: DevMailbox | undefined;
    private jobQueue: JobQueue<IntermediateEmailDetails> | undefined;
    private testingProcessor: EmailProcessor | undefined;

    /** @internal */
    constructor(
        private eventBus: EventBus,
        private moduleRef: ModuleRef,
        private emailProcessor: EmailProcessor,
        private renderService: EmailRenderService,
        private jobQueueService: JobQueueService,
        private processContext: ProcessContext,
        @Inject(EMAIL_PLUGIN_OPTIONS) private options: InitializedEmailPluginOptions,
    ) {}

    /**
     * Set the plugin options.
     */
    static init(options: EmailPluginOptions | EmailPluginDevModeOptions): Type<EmailPlugin> {
        const templateLoaders = toArray(options.templateLoader);
        if (options.templatePath) {
            // TODO: remove when the deprecated templatePath option is removed
            templateLoaders.push(new FileBasedTemplateLoader(options.templatePath));
        }
        this.options = {
            ...options,
            templateLoaders,
            emailGenerators: [
                ...toArray(options.emailGenerator),
                new ReactEmailGenerator(),
                new HandlebarsMjmlGenerator(),
            ],
        } as InitializedEmailPluginOptions;
        return EmailPlugin;
    }

    /** @internal */
    async onApplicationBootstrap(): Promise<void> {
        await this.initInjectableStrategies();
        await this.renderService.init();
        await this.setupEventSubscribers();
        const transport = await resolveTransportSettings(this.options, new Injector(this.moduleRef));
        if (!isDevModeOptions(this.options) && transport.type === 'testing') {
            // When running tests, we don't want to go through the JobQueue system,
            // so we just call the email sending logic directly.
            this.testingProcessor = new EmailProcessor(
                this.options,
                this.moduleRef,
                this.eventBus,
                this.renderService,
            );
            await this.testingProcessor.init();
        } else {
            await this.emailProcessor.init();
            this.jobQueue = await this.jobQueueService.createQueue({
                name: 'send-email',
                process: job => {
                    return this.emailProcessor.process(job.data);
                },
            });
        }
    }

    async onApplicationShutdown() {
        await this.destroyInjectableStrategies();
    }

    configure(consumer: MiddlewareConsumer) {
        if (isDevModeOptions(this.options) && this.processContext.isServer) {
            const productionWarning = getDevModeProductionWarning(this.options);
            if (productionWarning) {
                Logger.warn(productionWarning, loggerCtx);
            }
            Logger.info('Creating dev mailbox middleware', loggerCtx);
            this.devMailbox = new DevMailbox();
            const devApi = new DevEmailApi({
                options: this.options,
                injector: new Injector(this.moduleRef),
                renderService: this.renderService,
                outbox: new DevOutbox(getDevOutboxDir(this.options.outputPath)),
                resolveGlobalTemplateVars: ctx => this.resolveGlobalTemplateVars(ctx),
                enqueue: details => this.enqueue(details),
            });
            consumer
                .apply(this.devMailbox.serve(this.options, devApi.router()))
                .forRoutes(this.options.route);
            this.devMailbox.handleMockEvent((handler, event) => this.handleEvent(handler, event));
            registerPluginStartupMessage('Dev mailbox', this.options.route);
        }
    }

    private async initInjectableStrategies() {
        const injector = new Injector(this.moduleRef);
        if (typeof this.options.emailSender?.init === 'function') {
            await this.options.emailSender.init(injector);
        }
    }

    private async destroyInjectableStrategies() {
        await this.renderService.destroy();
        if (typeof this.options.emailSender?.destroy === 'function') {
            await this.options.emailSender.destroy();
        }
    }

    private async setupEventSubscribers() {
        for (const handler of EmailPlugin.options.handlers) {
            this.eventBus.ofType(handler.event).subscribe(event => {
                return this.handleEvent(handler, event);
            });
        }
    }

    private async handleEvent(
        handler: EmailEventHandler | EmailEventHandlerWithAsyncData<any>,
        event: EventWithContext,
    ) {
        Logger.debug(`Handling event "${handler.type}"`, loggerCtx);
        try {
            const injector = new Injector(this.moduleRef);
            const globalTemplateVars = await this.resolveGlobalTemplateVars(event.ctx);
            const result = await handler.handle(event as any, globalTemplateVars, injector);
            if (!result) {
                return;
            }
            await this.enqueue(result);
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
        }
    }

    private async resolveGlobalTemplateVars(ctx: RequestContext): Promise<{ [key: string]: any }> {
        const globalTemplateVars = this.options.globalTemplateVars;
        if (typeof globalTemplateVars === 'function') {
            return globalTemplateVars(ctx, new Injector(this.moduleRef));
        }
        return globalTemplateVars ?? {};
    }

    private async enqueue(details: IntermediateEmailDetails) {
        if (this.jobQueue) {
            await this.jobQueue.add(details, { retries: 5 });
        } else if (this.testingProcessor) {
            await this.testingProcessor.process(details);
        } else {
            throw new Error(
                'The EmailPlugin has not finished bootstrapping, so the email cannot be queued yet',
            );
        }
    }
}

function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? [...value] : [value];
}
