import * as parser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import plugin from './index';

function lint(ruleName: string, code: string, severity: 'error' | 'warn' = 'error') {
    const linter = new Linter();
    linter.defineParser('@typescript-eslint/parser', parser as any);
    linter.defineRule(`vendure/${ruleName}`, plugin.rules[ruleName]);
    return linter.verify(code, {
        parser: '@typescript-eslint/parser',
        parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            [`vendure/${ruleName}`]: severity,
        },
    });
}

describe('@vendure/eslint-plugin', () => {
    it('scopes plugin-only rules to src/plugins files in the recommended config', () => {
        expect(plugin.configs.recommended[0].rules).not.toHaveProperty('vendure/no-process-env-in-plugin');
        expect(plugin.configs.recommended[1].files).toEqual(['**/src/plugins/**/*.ts']);
        expect(plugin.configs.recommended[1].rules).toHaveProperty('vendure/no-process-env-in-plugin');
    });

    it('reports process.env usage in plugin code', () => {
        const messages = lint(
            'no-process-env-in-plugin',
            `
            export const apiKey = process.env.API_KEY;
            export const secret = process['env'].SECRET;
        `,
        );

        expect(messages).toHaveLength(2);
    });

    it('reports synchronize: true', () => {
        const messages = lint(
            'no-synchronize-true',
            `
            export const config = {
                dbConnectionOptions: {
                    synchronize: true,
                },
            };
        `,
        );

        expect(messages).toHaveLength(1);
    });

    it('requires compatibility metadata on Vendure plugins', () => {
        const invalid = lint(
            'require-plugin-compatibility',
            `
            @VendurePlugin({
                imports: [PluginCommonModule],
            })
            export class ReviewsPlugin {}
        `,
        );
        const valid = lint(
            'require-plugin-compatibility',
            `
            @VendurePlugin({
                imports: [PluginCommonModule],
                compatibility: '^3.0.0',
            })
            export class ReviewsPlugin {}
        `,
        );

        expect(invalid).toHaveLength(1);
        expect(valid).toHaveLength(0);
    });

    it('disallows static plugin option reads outside the plugin class', () => {
        const invalid = lint(
            'no-static-plugin-options-outside-plugin',
            `
            @VendurePlugin({
                providers: [{ provide: TOKEN, useFactory: () => ReviewsPlugin.options }],
                compatibility: '^3.0.0',
            })
            export class ReviewsPlugin {
                static options: ReviewsPluginOptions;
                static init(options: ReviewsPluginOptions) {
                    this.options = options;
                    return ReviewsPlugin;
                }
            }

            export class ReviewsService {
                get apiKey() {
                    return ReviewsPlugin.options.apiKey;
                }
            }
        `,
        );
        const valid = lint(
            'no-static-plugin-options-outside-plugin',
            `
            @VendurePlugin({
                providers: [{ provide: TOKEN, useFactory: () => ReviewsPlugin.options }],
                compatibility: '^3.0.0',
            })
            export class ReviewsPlugin {
                static options: ReviewsPluginOptions;
                static init(options: ReviewsPluginOptions) {
                    this.options = options;
                    return ReviewsPlugin;
                }
            }
        `,
        );

        expect(invalid).toHaveLength(1);
        expect(valid).toHaveLength(0);
    });

    it('warns when TransactionalConnection.getRepository omits an available RequestContext', () => {
        const invalid = lint(
            'use-transactional-connection-with-ctx',
            `
            export class ReviewsService {
                constructor(private connection: TransactionalConnection) {}
                async update(ctx: RequestContext, id: ID) {
                    return this.connection.getRepository(Review).save({ id });
                }
            }
        `,
            'warn',
        );
        const valid = lint(
            'use-transactional-connection-with-ctx',
            `
            export class ReviewsService {
                constructor(private connection: TransactionalConnection) {}
                async update(ctx: RequestContext, id: ID) {
                    return this.connection.getRepository(ctx, Review).save({ id });
                }
            }
        `,
            'warn',
        );

        expect(invalid).toHaveLength(1);
        expect(valid).toHaveLength(0);
    });

    it('warns when job queues are created outside lifecycle methods', () => {
        const invalid = lint(
            'require-job-queue-lifecycle-registration',
            `
            export class ReviewsService {
                constructor(private jobQueueService: JobQueueService) {}
                async trigger() {
                    return this.jobQueueService.createQueue({ name: 'reviews', process: async job => job.data });
                }
            }
        `,
            'warn',
        );
        const valid = lint(
            'require-job-queue-lifecycle-registration',
            `
            export class ReviewsService implements OnModuleInit {
                constructor(private jobQueueService: JobQueueService) {}
                async onModuleInit() {
                    this.queue = await this.jobQueueService.createQueue({ name: 'reviews', process: async job => job.data });
                }
            }
        `,
            'warn',
        );

        expect(invalid).toHaveLength(1);
        expect(valid).toHaveLength(0);
    });

    it('warns when raw RequestContext is passed as job data', () => {
        const invalid = lint(
            'no-raw-request-context-in-job-data',
            `
            export class ReviewsService {
                trigger(ctx: RequestContext) {
                    this.reviewQueue.add({ ctx, reviewId: 1 });
                    this.reviewQueue.add(ctx);
                }
            }
        `,
            'warn',
        );
        const valid = lint(
            'no-raw-request-context-in-job-data',
            `
            export class ReviewsService {
                trigger(ctx: RequestContext) {
                    this.reviewQueue.add({ ctx: ctx.serialize(), reviewId: 1 });
                }
            }
        `,
            'warn',
        );

        expect(invalid).toHaveLength(2);
        expect(valid).toHaveLength(0);
    });
});
