import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { DynamicModule } from '@nestjs/common';
import { GraphQLModule, GraphQLTypesLoader } from '@nestjs/graphql';
import { GraphQLSchema, printSchema, ValidationContext } from 'graphql';

import { ConfigModule } from '../../config/config.module';
import { ConfigService } from '../../config/config.service';
import { I18nModule } from '../../i18n/i18n.module';
import { I18nService } from '../../i18n/i18n.service';
import { ServiceModule } from '../../service/service.module';
import { ApiSharedModule } from '../api-internal-modules';
import { CustomFieldRelationResolverService } from '../common/custom-field-relation-resolver.service';
import { IdCodecService } from '../common/id-codec.service';
import { AssetInterceptorPlugin } from '../middleware/asset-interceptor-plugin';
import { IdCodecPlugin } from '../middleware/id-codec-plugin';
import { TranslateErrorsPlugin } from '../middleware/translate-errors-plugin';

import { generateResolvers } from './generate-resolvers';
import { getFinalVendureSchema, isUsingDefaultEntityIdStrategy } from './get-final-vendure-schema';

export interface GraphQLApiOptions {
    apiType: 'shop' | 'admin';
    typePaths: string[];
    apiPath: string;
    debug: boolean;
    playground: boolean | any;
    // eslint-disable-next-line @typescript-eslint/ban-types
    resolverModule: Function;
    validationRules: Array<(context: ValidationContext) => any>;
}

/**
 * Dynamically generates a GraphQLModule according to the given config options.
 */
export function configureGraphQLModule(
    getOptions: (configService: ConfigService) => GraphQLApiOptions,
): DynamicModule {
    return GraphQLModule.forRootAsync<ApolloDriverConfig>({
        driver: ApolloDriver,
        useFactory: (
            configService: ConfigService,
            i18nService: I18nService,
            idCodecService: IdCodecService,
            typesLoader: GraphQLTypesLoader,
            customFieldRelationResolverService: CustomFieldRelationResolverService,
        ) => {
            return createGraphQLOptions(
                i18nService,
                configService,
                idCodecService,
                typesLoader,
                customFieldRelationResolverService,
                getOptions(configService),
            );
        },
        inject: [
            ConfigService,
            I18nService,
            IdCodecService,
            GraphQLTypesLoader,
            CustomFieldRelationResolverService,
        ],
        imports: [ConfigModule, I18nModule, ApiSharedModule, ServiceModule],
    });
}

async function createGraphQLOptions(
    i18nService: I18nService,
    configService: ConfigService,
    idCodecService: IdCodecService,
    typesLoader: GraphQLTypesLoader,
    customFieldRelationResolverService: CustomFieldRelationResolverService,
    options: GraphQLApiOptions,
): Promise<ApolloDriverConfig> {
    const builtSchema = await buildSchemaForApi(options.apiType);
    const resolvers = await generateResolvers(
        configService,
        customFieldRelationResolverService,
        options.apiType,
        builtSchema,
    );

    const apolloServerPlugins = [
        new TranslateErrorsPlugin(i18nService),
        new AssetInterceptorPlugin(configService),
        ...configService.apiOptions.apolloServerPlugins,
    ];

    // We only need to add the IdCodecPlugin if the user has configured
    // a non-default EntityIdStrategy. This is a performance optimization
    // that prevents unnecessary traversal of each response when no
    // actual encoding/decoding is taking place.
    if (
        !isUsingDefaultEntityIdStrategy(
            configService.entityOptions.entityIdStrategy ?? configService.entityIdStrategy,
        )
    ) {
        apolloServerPlugins.unshift(new IdCodecPlugin(idCodecService));
    }

    return {
        path: '/' + options.apiPath,
        typeDefs: printSchema(builtSchema),
        include: [options.resolverModule],
        inheritResolversFromInterfaces: true,
        fieldResolverEnhancers: ['guards'],
        resolvers,
        // We no longer rely on the upload facility bundled with Apollo Server, and instead
        // manually configure the graphql-upload package. See https://github.com/vendurehq/vendure/issues/396
        uploads: false,
        playground: options.playground,
        csrfPrevention: false,
        debug: options.debug || false,
        context: (req: any) => req,
        // This is handled by the Express cors plugin
        cors: false,
        cache: configService.apiOptions.cache,
        plugins: apolloServerPlugins,
        validationRules: options.validationRules,
        introspection: configService.apiOptions.introspection ?? true,
    } as ApolloDriverConfig;

    /**
     * Generates the server's GraphQL schema by combining:
     * 1. the default schema as defined in the source .graphql files specified by `typePaths`
     * 2. any custom fields defined in the config
     * 3. any schema extensions defined by plugins
     */
    async function buildSchemaForApi(apiType: 'shop' | 'admin'): Promise<GraphQLSchema> {
        return getFinalVendureSchema({
            config: configService,
            typePaths: options.typePaths,
            typesLoader,
            apiType,
        });
    }
}
