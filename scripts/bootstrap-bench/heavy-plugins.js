/**
 * Generates N synthetic plugins modeled on real-world plugin patterns:
 * - an entity with a handful of columns
 * - admin + shop GraphQL API extensions (one query each)
 * - custom fields added via a configuration function
 * - onModuleInit + onApplicationBootstrap hooks that each run a DB query
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
        const PluginClass = class {
            constructor(connection) {
                this.connection = connection;
            }
            async onModuleInit() {
                await this.connection.rawConnection.getRepository(EntityClass).count();
            }
            async onApplicationBootstrap() {
                await this.connection.rawConnection.getRepository(EntityClass).count();
            }
        };
        Object.defineProperty(PluginClass, 'name', { value: `BenchPlugin${i}` });
        Inject(TransactionalConnection)(PluginClass, undefined, 0);

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
    return plugins;
}

module.exports = { createHeavyPlugins };
