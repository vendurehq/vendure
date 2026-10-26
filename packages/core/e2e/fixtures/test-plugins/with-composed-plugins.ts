import { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import { VendureEntity, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';
import { Entity } from 'typeorm';

let configurationInvocationCount = 0;

@VendurePlugin({
    configuration: config => {
        configurationInvocationCount++;
        return config;
    },
})
export class DeduplicatedDynamicPlugin implements OnApplicationShutdown {
    static init(): DynamicModule {
        return { module: DeduplicatedDynamicPlugin };
    }

    static get configurationInvocationCount(): number {
        return configurationInvocationCount;
    }

    onApplicationShutdown(): void {
        configurationInvocationCount = 0;
    }
}

@Entity()
export class CompositeTestEntity extends VendureEntity {}

@VendurePlugin({ entities: [CompositeTestEntity] })
class CompositeEntityPlugin {}

@VendurePlugin({
    configuration: config => {
        config.customFields.Product.push({
            name: 'composedPluginField',
            type: 'string',
            nullable: true,
        });
        return config;
    },
})
class CompositeConfigurationPlugin {}

@Resolver()
class CompositeResolver {
    @Query()
    composedPluginQuery(): string {
        return 'composed';
    }
}

@VendurePlugin({
    shopApiExtensions: {
        schema: gql`
            extend type Query {
                composedPluginQuery: String!
            }
        `,
        resolvers: [CompositeResolver],
    },
})
class CompositeApiPlugin {}

export const deduplicatedDynamicPlugin = DeduplicatedDynamicPlugin.init();

@VendurePlugin({
    plugins: [
        CompositeEntityPlugin,
        CompositeConfigurationPlugin,
        CompositeApiPlugin,
        deduplicatedDynamicPlugin,
    ],
})
export class CompositeTestPlugin {}
