import { HttpAdapterHost } from '@nestjs/core';
import type { GraphQLSchemaHost, GraphQLWsSubscriptionsConfig } from '@nestjs/graphql';
import { Express, Request, Response } from 'express';
import {
    DocumentNode,
    getOperationAST,
    GraphQLError,
    parse,
    specifiedRules,
    validate,
    ValidationContext,
} from 'graphql';
import { IncomingMessage, maxHeaderSize, ServerResponse } from 'http';

import { ForbiddenError } from '../../common/error/errors';
import { ConfigService } from '../../config/config.service';
import { LogLevel } from '../../config/logger/vendure-logger';
import { CachedSession } from '../../config/session-cache/session-cache-strategy';
import { I18nRequest, I18nService } from '../../i18n/i18n.service';
import { SessionService } from '../../service/services/session.service';
import { internal_getRequestContext, internal_setRequestContext } from '../common/request-context';
import { AssetInterceptorPlugin } from '../middleware/asset-interceptor-plugin';
import { IdCodecPlugin } from '../middleware/id-codec-plugin';

// The size limit which Express applies to the JSON body of an HTTP request by default
const MAX_OPERATION_SIZE = 100 * 1024;

/**
 * Creates the graphql-ws options with which subscriptions are served over WebSocket.
 *
 * Each operation is given an Express request which inherits from the upgrade request, and a
 * response which is never sent, so that it passes through the same guards and resolvers as
 * an HTTP request. The connection params and the operations are held to the size limits of
 * the headers and the body of an HTTP request.
 */
export function createSubscriptionServerOptions(options: {
    validationRules: Array<(context: ValidationContext) => any>;
    configService: ConfigService;
    i18nService: I18nService;
    sessionService: SessionService;
    httpAdapterHost: HttpAdapterHost;
    schemaHost: GraphQLSchemaHost;
    assetInterceptorPlugin: AssetInterceptorPlugin;
    idCodecPlugin?: IdCodecPlugin;
}): GraphQLWsSubscriptionsConfig {
    const {
        configService,
        i18nService,
        sessionService,
        httpAdapterHost,
        schemaHost,
        assetInterceptorPlugin,
        idCodecPlugin,
    } = options;
    const { channelTokenKey } = configService.apiOptions;
    const { apiKeyHeaderKey, disableAuth, entityAccessControlStrategy } = configService.authOptions;
    const validationRules = [...specifiedRules, ...options.validationRules];
    const headerKeys = ['authorization', channelTokenKey, apiKeyHeaderKey].map(key => key.toLowerCase());
    const i18nHandler = i18nService.handle();

    function createContext(
        upgradeRequest: IncomingMessage,
        connectionParams: Readonly<Record<string, unknown>>,
        payload: unknown,
    ) {
        const app = httpAdapterHost.httpAdapter.getInstance<Express>();
        Object.setPrototypeOf(upgradeRequest, app.request);
        const req: Request = Object.create(upgradeRequest);
        req.headers = { ...upgradeRequest.headers };
        // WebSocket connections are not protected by CORS, so their cookies must not be used
        delete req.headers.cookie;
        for (const [key, value] of Object.entries(connectionParams)) {
            if (typeof value === 'string' && headerKeys.includes(key.toLowerCase())) {
                req.headers[key.toLowerCase()] = value;
            }
        }
        // The body of an HTTP request, which the @Relations() decorator reads
        req.body = payload;
        const res: Response = Object.setPrototypeOf(new ServerResponse(req), app.response);
        i18nHandler(req, res, () => undefined);
        return { req, res };
    }

    async function assertSessionIsStillValid(req: I18nRequest) {
        const { session } = internal_getRequestContext(req);
        if (!session?.token || disableAuth) {
            return;
        }
        const current = await sessionService.getSessionFromToken(session.token);
        if (!current || hasLostPermissions(session, current)) {
            const error = new ForbiddenError(LogLevel.Verbose);
            // graphql-ws sends an error thrown from onNext to this operation only, which ends it
            throw i18nService.translateError(req, new GraphQLError(error.message, { originalError: error }));
        }
    }

    // Services cache data per RequestContext, so the next result is resolved with a fresh copy,
    // which is prepared for the EntityAccessControlStrategy like that of an HTTP request
    async function renewRequestContext(req: Request) {
        const ctx = internal_getRequestContext(req).copy();
        if (!disableAuth) {
            await entityAccessControlStrategy.prepareAccessControl?.(ctx);
        }
        internal_setRequestContext(req, ctx);
    }

    return {
        onConnect: ({ connectionParams }) => {
            if (JSON.stringify(connectionParams ?? {}).length > maxHeaderSize) {
                return false;
            }
        },
        onSubscribe: ({ connectionParams, extra }, id, payload) => {
            if (JSON.stringify(payload).length > MAX_OPERATION_SIZE) {
                return [new GraphQLError('The operation is too large')];
            }
            let document: DocumentNode;
            try {
                document = parse(payload.query);
            } catch (error) {
                return [error instanceof GraphQLError ? error : new GraphQLError((error as Error).message)];
            }
            const operation = getOperationAST(document, payload.operationName);
            if (operation && operation.operation !== 'subscription') {
                return [new GraphQLError('Only subscription operations are supported over WebSocket')];
            }
            const { schema } = schemaHost;
            const errors = validate(schema, document, validationRules);
            if (errors.length) {
                return errors;
            }
            return {
                schema,
                document,
                operationName: payload.operationName,
                variableValues: payload.variables,
                contextValue: createContext(getUpgradeRequest(extra), connectionParams ?? {}, payload),
            };
        },
        onNext: async (ctx, id, payload, { contextValue, document }, { data, errors }) => {
            const { req } = contextValue as { req: I18nRequest };
            // Only the error of subscribing has no data; the data of a failed result is null
            if (data !== undefined) {
                await assertSessionIsStillValid(req);
                idCodecPlugin?.encodeIdFields(document, data);
                assetInterceptorPlugin.prefixAssetUrls(req, document, data);
                await renewRequestContext(req);
            }
            errors?.forEach(error => i18nService.translateError(req, error));
        },
    };
}

function getUpgradeRequest(extra: unknown): IncomingMessage {
    return (extra as { request: IncomingMessage }).request;
}

function hasLostPermissions(
    session: Pick<CachedSession, 'user'>,
    current: Pick<CachedSession, 'user'>,
): boolean {
    const currentPermissions = new Map(
        current.user?.channelPermissions.map(channel => [String(channel.id), new Set(channel.permissions)]),
    );
    return !!session.user?.channelPermissions.some(channel =>
        channel.permissions.some(permission => !currentPermissions.get(String(channel.id))?.has(permission)),
    );
}
