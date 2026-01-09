import { ExecutionContext } from '@nestjs/common';
import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ID, JsonCompatible } from '@vendure/common/lib/shared-types';
import { isObject } from '@vendure/common/lib/shared-utils';
import { Request } from 'express';
import { TFunction } from 'i18next';
import { EntityManager, ReplicationMode } from 'typeorm';

import {
    REQUEST_CONTEXT_KEY,
    REQUEST_CONTEXT_MAP_KEY,
    TRANSACTION_MANAGER_KEY,
} from '../../common/constants';
import { idsAreEqual } from '../../common/utils';
import { CachedSession } from '../../config/session-cache/session-cache-strategy';
import { Channel } from '../../entity/channel/channel.entity';

import { ApiType } from './get-api-type';

export type SerializedRequestContext = {
    _req?: any;
    _session: JsonCompatible<Required<CachedSession>>;
    _apiType: ApiType;
    _channel: JsonCompatible<Channel>;
    _languageCode: LanguageCode;
    _isAuthorized: boolean;
    _authorizedAsOwnerOnly: boolean;
};

/**
 * This object is used to store the RequestContext on the Express Request object.
 */
interface RequestContextStore {
    /**
     * This is the default RequestContext for the handler.
     */
    default: RequestContext;
    /**
     * If a transaction is started, the resulting RequestContext is stored here.
     * This RequestContext will have a transaction manager attached via the
     * TRANSACTION_MANAGER_KEY symbol.
     *
     * When a transaction is started, the TRANSACTION_MANAGER_KEY symbol is added to the RequestContext
     * object. This is then detected inside the {@link internal_setRequestContext} function and the
     * RequestContext object is stored in the RequestContextStore under the withTransactionManager key.
     */
    withTransactionManager?: RequestContext;
}

interface RequestWithStores extends Request {
    // eslint-disable-next-line @typescript-eslint/ban-types
    [REQUEST_CONTEXT_MAP_KEY]?: Map<Function, RequestContextStore>;
    [REQUEST_CONTEXT_KEY]?: RequestContextStore;
}

/**
 * @description
 * This function is used to set the {@link RequestContext} on the `req` object. This is the underlying
 * mechanism by which we are able to access the `RequestContext` from different places.
 *
 * For example, here is a diagram to show how, in an incoming API request, we are able to store
 * and retrieve the `RequestContext` in a resolver:
 * ```
 * - query { product }
 * |
 * - AuthGuard.canActivate()
 * |  | creates a `RequestContext`, stores it on `req`
 * |
 * - product() resolver
 *    | @Ctx() decorator fetching `RequestContext` from `req`
 * ```
 *
 * We named it this way to discourage usage outside the framework internals.
 */
export function internal_setRequestContext(
    req: RequestWithStores,
    ctx: RequestContext,
    executionContext?: ExecutionContext,
) {
    // If we have access to the `ExecutionContext`, it means we are able to bind
    // the `ctx` object to the specific "handler", i.e. the resolver function (for GraphQL)
    // or controller (for REST).
    let item: RequestContextStore | undefined;
    if (executionContext && typeof executionContext.getHandler === 'function') {
        // eslint-disable-next-line @typescript-eslint/ban-types
        const map = req[REQUEST_CONTEXT_MAP_KEY] || new Map();
        item = map.get(executionContext.getHandler());
        const ctxHasTransaction = Object.getOwnPropertySymbols(ctx).includes(TRANSACTION_MANAGER_KEY);
        if (item) {
            item.default = item.default ?? ctx;
            if (ctxHasTransaction) {
                item.withTransactionManager = ctx;
            }
        } else {
            item = {
                default: ctx,
                withTransactionManager: ctxHasTransaction ? ctx : undefined,
            };
        }
        map.set(executionContext.getHandler(), item);

        req[REQUEST_CONTEXT_MAP_KEY] = map;
    }
    // We also bind to a shared key so that we can access the `ctx` object
    // later even if we don't have a reference to the `ExecutionContext`
    req[REQUEST_CONTEXT_KEY] = item ?? {
        default: ctx,
    };
}

/**
 * @description
 * Gets the {@link RequestContext} from the `req` object. See {@link internal_setRequestContext}
 * for more details on this mechanism.
 */
export function internal_getRequestContext(
    req: RequestWithStores,
    executionContext?: ExecutionContext,
): RequestContext {
    let item: RequestContextStore | undefined;
    if (executionContext && typeof executionContext.getHandler === 'function') {
        // eslint-disable-next-line @typescript-eslint/ban-types
        const map = req[REQUEST_CONTEXT_MAP_KEY];
        item = map?.get(executionContext.getHandler());
        // If we have a ctx associated with the current handler (resolver function), we
        // return it. Otherwise, we fall back to the shared key which will be there.
        if (item) {
            return item.withTransactionManager || item.default;
        }
    }
    if (!item) {
        item = req[REQUEST_CONTEXT_KEY] as RequestContextStore;
    }
    const transactionalCtx =
        item?.withTransactionManager &&
        ((item.withTransactionManager as any)[TRANSACTION_MANAGER_KEY] as EntityManager | undefined)
            ?.queryRunner?.isReleased === false
            ? item.withTransactionManager
            : undefined;

    return transactionalCtx || item.default;
}

/**
 * @description
 * The RequestContext holds information relevant to the current request, which may be
 * required at various points of the stack.
 *
 * It is a good practice to inject the RequestContext (using the {@link Ctx} decorator) into
 * _all_ resolvers & REST handler, and then pass it through to the service layer.
 *
 * This allows the service layer to access information about the current user, the active language,
 * the active Channel, and so on. In addition, the {@link TransactionalConnection} relies on the
 * presence of the RequestContext object in order to correctly handle per-request database transactions.
 *
 * The RequestContext also provides mechanisms for managing the database replication mode via the
 * `setReplicationMode` method and the `replicationMode` getter. This allows for finer control
 * over whether database queries within the context should be executed against the master or a replica
 * database, which can be particularly useful in distributed database environments.
 *
 * @example
 * ```ts
 * \@Query()
 * myQuery(\@Ctx() ctx: RequestContext) {
 *   return this.myService.getData(ctx);
 * }
 * ```
 *
 * @example
 * ```ts
 * \@Query()
 * myMutation(\@Ctx() ctx: RequestContext) {
 *   ctx.setReplicationMode('master');
 *   return this.myService.getData(ctx);
 * }
 * ```
 * @docsCategory request
 */
export class RequestContext {
    private readonly _languageCode: LanguageCode;
    private readonly _currencyCode: CurrencyCode;
    private readonly _channel: Channel;
    private readonly _session?: CachedSession;
    private readonly _isAuthorized: boolean;
    private readonly _authorizedAsOwnerOnly: boolean;
    private readonly _translationFn: TFunction;
    private readonly _apiType: ApiType;
    private readonly _req?: Request;
    private _replicationMode?: ReplicationMode;

    /**
     * @internal
     */
    constructor(options: {
        req?: Request;
        apiType: ApiType;
        channel: Channel;
        session?: CachedSession;
        languageCode?: LanguageCode;
        currencyCode?: CurrencyCode;
        isAuthorized: boolean;
        authorizedAsOwnerOnly: boolean;
        translationFn?: TFunction;
    }) {
        const { req, apiType, channel, session, languageCode, currencyCode, translationFn } = options;
        this._req = req;
        this._apiType = apiType;
        this._channel = channel;
        this._session = session;
        this._languageCode = languageCode || (channel && channel.defaultLanguageCode);
        this._currencyCode = currencyCode || (channel && channel.defaultCurrencyCode);
        this._isAuthorized = options.isAuthorized;
        this._authorizedAsOwnerOnly = options.authorizedAsOwnerOnly;
        this._translationFn = translationFn || (((key: string) => key) as any);
    }

    /**
     * @description
     * Creates an "empty" RequestContext object. This is only intended to be used
     * when a service method must be called outside the normal request-response
     * cycle, e.g. when programmatically populating data. Usually a better alternative
     * is to use the {@link RequestContextService} `create()` method, which allows more control
     * over the resulting RequestContext object.
     */
    static empty(): RequestContext {
        return new RequestContext({
            apiType: 'admin',
            authorizedAsOwnerOnly: false,
            channel: new Channel(),
            isAuthorized: true,
        });
    }

    /**
     * @description
     * Creates a new RequestContext object from a serialized object created by the
     * `serialize()` method.
     */
    static deserialize(ctxObject: SerializedRequestContext): RequestContext {
        return new RequestContext({
            req: ctxObject._req,
            apiType: ctxObject._apiType,
            channel: new Channel(ctxObject._channel),
            session: {
                ...ctxObject._session,
                expires: ctxObject._session?.expires && new Date(ctxObject._session.expires),
            },
            languageCode: ctxObject._languageCode,
            isAuthorized: ctxObject._isAuthorized,
            authorizedAsOwnerOnly: ctxObject._authorizedAsOwnerOnly,
        });
    }

    /**
     * @description
     * Returns `true` if there is an active Session & User associated with this request,
     * and that User has **at least one** of the specified permissions on the active Channel.
     *
     * This method uses OR logic - it checks if the user has ANY of the given permissions,
     * not ALL of them. For AND logic, use {@link userHasAllPermissions}.
     *
     * @example
     * ```ts
     * // Returns true if user has ReadProduct OR ReadCatalog
     * ctx.userHasPermissions([Permission.ReadProduct, Permission.ReadCatalog]);
     * ```
     */
    userHasPermissions(permissions: Permission[]): boolean {
        const user = this.session?.user;
        if (!user || !this.channelId) {
            return false;
        }
        const permissionsOnChannel = user.channelPermissions.find(c => idsAreEqual(c.id, this.channelId));
        if (permissionsOnChannel) {
            return this.arraysIntersect(permissionsOnChannel.permissions, permissions);
        }
        return false;
    }

    /**
     * @description
     * Returns `true` if there is an active Session & User associated with this request,
     * and that User has **all** of the specified permissions on the active Channel.
     *
     * This method uses AND logic - it checks if the user has EVERY one of the given permissions.
     * For OR logic (any permission), use {@link userHasPermissions}.
     *
     * @example
     * ```ts
     * // Returns true only if user has BOTH ReadProduct AND UpdateProduct
     * ctx.userHasAllPermissions([Permission.ReadProduct, Permission.UpdateProduct]);
     * ```
     *
     * @since 3.6.0
     */
    userHasAllPermissions(permissions: Permission[]): boolean {
        const user = this.session?.user;
        if (!user || !this.channelId) {
            return false;
        }
        const permissionsOnChannel = user.channelPermissions.find(c => idsAreEqual(c.id, this.channelId));
        if (permissionsOnChannel) {
            return permissions.every(permission => permissionsOnChannel.permissions.includes(permission));
        }
        return false;
    }

    /**
     * @description
     * Serializes the RequestContext object into a JSON-compatible simple object.
     * This is useful when you need to send a RequestContext object to another
     * process, e.g. to pass it to the Job Queue via the {@link JobQueueService}.
     */
    serialize(): SerializedRequestContext {
        const serializableThis: any = Object.assign({}, this);
        if (this._req) {
            serializableThis._req = this.shallowCloneRequestObject(this._req);
        }
        return JSON.parse(JSON.stringify(serializableThis));
    }

    /**
     * @description
     * Creates a shallow copy of the RequestContext instance. This means that
     * mutations to the copy itself will not affect the original, but deep mutations
     * (e.g. copy.channel.code = 'new') *will* also affect the original.
     */
    copy(): RequestContext {
        return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    }

    /**
     * @description
     * The raw Express request object.
     */
    get req(): Request | undefined {
        return this._req;
    }

    /**
     * @description
     * Signals which API this request was received by, e.g. `admin` or `shop`.
     */
    get apiType(): ApiType {
        return this._apiType;
    }

    /**
     * @description
     * The active {@link Channel} of this request.
     */
    get channel(): Channel {
        return this._channel;
    }

    get channelId(): ID {
        return this._channel.id;
    }

    get languageCode(): LanguageCode {
        return this._languageCode;
    }

    get currencyCode(): CurrencyCode {
        return this._currencyCode;
    }

    get session(): CachedSession | undefined {
        return this._session;
    }

    get activeUserId(): ID | undefined {
        return this.session?.user?.id;
    }

    /**
     * @description
     * True if the current session is authorized to access the current resolver method.
     *
     * @deprecated Use `userHasPermissions()` method instead.
     */
    get isAuthorized(): boolean {
        return this._isAuthorized;
    }

    /**
     * @description
     * True if the current anonymous session is only authorized to operate on entities that
     * are owned by the current session.
     */
    get authorizedAsOwnerOnly(): boolean {
        return this._authorizedAsOwnerOnly;
    }

    /**
     * @description
     * Translate the given i18n key
     */
    translate(key: string, variables?: { [k: string]: any }): string {
        try {
            return this._translationFn(key, variables);
        } catch (e: any) {
            return `Translation format error: ${JSON.stringify(e.message)}). Original key: ${key}`;
        }
    }

    /**
     * Returns true if any element of arr1 appears in arr2.
     */
    private arraysIntersect<T>(arr1: T[], arr2: T[]): boolean {
        return arr1.reduce((intersects, role) => {
            return intersects || arr2.includes(role);
        }, false as boolean);
    }

    /**
     * The Express "Request" object is huge and contains many circular
     * references. We will preserve just a subset of the whole, by preserving
     * only the serializable properties up to 2 levels deep.
     * @private
     */
    private shallowCloneRequestObject(req: Request) {
        function copySimpleFieldsToDepth(target: any, maxDepth: number, depth: number = 0) {
            const result: any = {};
            // eslint-disable-next-line guard-for-in
            for (const key in target) {
                if (key === 'host' && depth === 0) {
                    // avoid Express "deprecated: req.host" warning
                    continue;
                }
                let val: any;
                try {
                    val = target[key];
                } catch (e: any) {
                    val = String(e);
                }

                if (Array.isArray(val)) {
                    depth++;
                    result[key] = val.map(v => {
                        if (!isObject(v) && typeof val !== 'function') {
                            return v;
                        } else {
                            return copySimpleFieldsToDepth(v, maxDepth, depth);
                        }
                    });
                    depth--;
                } else if (!isObject(val) && typeof val !== 'function') {
                    result[key] = val;
                } else if (depth < maxDepth) {
                    depth++;
                    result[key] = copySimpleFieldsToDepth(val, maxDepth, depth);
                    depth--;
                }
            }
            return result;
        }
        return copySimpleFieldsToDepth(req, 1);
    }

    /**
     * @description
     * Sets the replication mode for the current RequestContext. This mode determines whether the operations
     * within this context should interact with the master database or a replica. Use this method to explicitly
     * define the replication mode for the context.
     *
     * @param mode - The replication mode to be set (e.g., 'master' or 'replica').
     */
    setReplicationMode(mode: ReplicationMode): void {
        this._replicationMode = mode;
    }

    /**
     * @description
     * Gets the current replication mode of the RequestContext. If no replication mode has been set,
     * it returns `undefined`. This property indicates whether the context is configured to interact with
     * the master database or a replica.
     *
     * @returns The current replication mode, or `undefined` if none is set.
     */
    get replicationMode(): ReplicationMode | undefined {
        return this._replicationMode;
    }
}
