/**
 * Generates N synthetic plugins modeled on real-world plugin patterns, based on
 * a survey of the vendure-platform and flowtech-monorepo codebases:
 * - an entity with a handful of columns
 * - admin + shop GraphQL API extensions (one query each)
 * - custom fields added via a configuration function
 * - onModuleInit: 1-2 job queues created via JobQueueService, an EventBus
 *   subscription with a DB-touching handler, and a DB query
 * - onApplicationBootstrap: sequential strategy `.init()` fan-out + a DB query
 *
 * Written in plain JS (decorators invoked manually) so benchmark runs measure
 * compiled-JS cost only, with no ts-node overhead.
 */
const { Entity, Column } = require('typeorm');
const { Resolver, Query } = require('@nestjs/graphql');
const gql = require('graphql-tag');

function createHeavyPlugins(core, count = 20) {
    const { VendurePlugin, PluginCommonModule, VendureEntity, TransactionalConnection, Injector } = core;
    const { Inject } = require('@nestjs/common');
    const plugins = [];

    for (let i = 0; i < count; i++) {
        // --- entity ---
        const entityName = `BenchEntity${i}`;
        const EntityClass = class extends VendureEntity {
            constructor(input) {
                super(input);
            }
        };
        Object.defineProperty(EntityClass, 'name', { value: entityName });
        for (const col of ['name', 'code', 'description']) {
            Column({ type: 'varchar', default: '' })(EntityClass.prototype, col);
        }
        Column({ type: 'int', default: 0 })(EntityClass.prototype, 'sortOrder');
        Entity()(EntityClass);

        // --- resolvers ---
        const makeResolver = (queryName) => {
            const ResolverClass = class {
                constructor(connection) {
                    this.connection = connection;
                }
            };
            Object.defineProperty(ResolverClass, 'name', { value: `BenchResolver_${queryName}` });
            ResolverClass.prototype[queryName] = function () {
                return `bench-${queryName}`;
            };
            Inject(TransactionalConnection)(ResolverClass, undefined, 0);
            const desc = Object.getOwnPropertyDescriptor(ResolverClass.prototype, queryName);
            Query(() => String, { name: queryName })(ResolverClass.prototype, queryName, desc);
            Resolver()(ResolverClass);
            return ResolverClass;
        };
        const adminResolver = makeResolver(`benchAdminQuery${i}`);
        const shopResolver = makeResolver(`benchShopQuery${i}`);

        // --- plugin class with lifecycle hooks ---
        const queueCount = i % 2 === 0 ? 2 : 1;
        const PluginClass = class {
            constructor(connection, jobQueueService, eventBus) {
                this.connection = connection;
                this.jobQueueService = jobQueueService;
                this.eventBus = eventBus;
                // pluggable-strategy pattern: 3 strategies inited sequentially at bootstrap
                this.strategies = [0, 1, 2].map(() => ({
                    init: async () => new Promise(resolve => setImmediate(resolve)),
                }));
            }
            async onModuleInit() {
                for (let q = 0; q < queueCount; q++) {
                    await this.jobQueueService.createQueue({
                        name: `bench-queue-${i}-${q}`,
                        process: async job => {
                            await this.connection.rawConnection.getRepository(EntityClass).count();
                            return job.data;
                        },
                    });
                }
                this.eventBus.ofType(core.ProductEvent).subscribe(() => {
                    void this.connection.rawConnection.getRepository(EntityClass).count();
                });
                await this.connection.rawConnection.getRepository(EntityClass).count();
            }
            async onApplicationBootstrap() {
                for (const strategy of this.strategies) {
                    await strategy.init();
                }
                await this.connection.rawConnection.getRepository(EntityClass).count();
            }
        };
        Object.defineProperty(PluginClass, 'name', { value: `BenchPlugin${i}` });
        Inject(TransactionalConnection)(PluginClass, undefined, 0);
        Inject(core.JobQueueService)(PluginClass, undefined, 1);
        Inject(core.EventBus)(PluginClass, undefined, 2);

        VendurePlugin({
            imports: [PluginCommonModule],
            entities: [EntityClass],
            adminApiExtensions: {
                schema: gql`extend type Query { benchAdminQuery${i}: String! }`,
                resolvers: [adminResolver],
            },
            shopApiExtensions: {
                schema: gql`extend type Query { benchShopQuery${i}: String! }`,
                resolvers: [shopResolver],
            },
            configuration: config => {
                config.customFields.Product.push({ name: `benchProductField${i}`, type: 'string', nullable: true });
                config.customFields.Customer.push({ name: `benchCustomerField${i}`, type: 'string', nullable: true });
                return config;
            },
            compatibility: '>0.0.0',
        })(PluginClass);

        plugins.push(PluginClass);
    }

    // Awaited external HTTP call at bootstrap (license-check pattern seen in the
    // wild). Deterministic: calls a local server that delays its response by
    // BENCH_EXT_HTTP_MS. Off by default so it doesn't drown other signals.
    const extHttpMs = Number(process.env.BENCH_EXT_HTTP_MS || 0);
    if (extHttpMs > 0) {
        const http = require('http');
        const ExternalCallPlugin = class {
            async onApplicationBootstrap() {
                const server = http.createServer((req, res) => {
                    setTimeout(() => res.end('ok'), extHttpMs);
                });
                await new Promise(resolve => server.listen(0, resolve));
                const { port } = server.address();
                await fetch(`http://127.0.0.1:${port}/verify`).then(r => r.text());
                server.close();
            }
        };
        Object.defineProperty(ExternalCallPlugin, 'name', { value: 'BenchExternalCallPlugin' });
        VendurePlugin({ compatibility: '>0.0.0' })(ExternalCallPlugin);
        plugins.push(ExternalCallPlugin);
    }
    return plugins;
}

module.exports = { createHeavyPlugins };
