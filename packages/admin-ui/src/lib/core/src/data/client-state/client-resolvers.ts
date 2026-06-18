import { InMemoryCache } from '@apollo/client/core';

import * as Codegen from '../../common/generated-types';
import { GetUserStatusQuery, LanguageCode, UserStatus } from '../../common/generated-types';
import { GET_NEWTORK_STATUS, GET_UI_STATE, GET_USER_STATUS } from '../definitions/client-definitions';

export type ResolverContext = {
    cache: InMemoryCache;
    optimisticResponse: any;
    getCacheKey: (storeObj: any) => string;
};

export type ResolverDefinition = {
    Mutation: {
        [name: string]: (rootValue: any, args: any, context: ResolverContext, info?: any) => any;
    };
};

export const clientResolvers: ResolverDefinition = {
    Mutation: {
        requestStarted: (_, args, { cache }): number => updateRequestsInFlight(cache, 1),
        requestCompleted: (_, args, { cache }): number => updateRequestsInFlight(cache, -1),
        setAsLoggedIn: (_, args: Codegen.SetAsLoggedInMutationVariables, { cache }): UserStatus => {
            const {
                input: { username, loginTime, channels, activeChannelId, administratorId },
            } = args;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const permissions = channels.find(c => c.id === activeChannelId)!.permissions;
            const data: { userStatus: UserStatus } = {
                userStatus: {
                    __typename: 'UserStatus',
                    administratorId,
                    username,
                    loginTime,
                    isLoggedIn: true,
                    permissions,
                    channels,
                    activeChannelId,
                },
            };
            cache.writeQuery({ query: GET_USER_STATUS, data });
            return data.userStatus;
        },
        setAsLoggedOut: (_, args, { cache }): UserStatus => {
            const data: GetUserStatusQuery = {
                userStatus: {
                    __typename: 'UserStatus',
                    administratorId: null,
                    username: '',
                    loginTime: '',
                    isLoggedIn: false,
                    permissions: [],
                    channels: [],
                    activeChannelId: null,
                },
            };
            cache.writeQuery({ query: GET_USER_STATUS, data });
            return data.userStatus;
        },
        setUiLanguage: (_, args: Codegen.SetUiLanguageMutationVariables, { cache }): LanguageCode => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const previous = cache.readQuery<Codegen.GetUiStateQuery>({ query: GET_UI_STATE })!;
            const data = updateUiState(previous, 'language', args.languageCode);
            cache.writeQuery({ query: GET_UI_STATE, data });
            return args.languageCode;
        },
        setUiLocale: (_, args: Codegen.SetUiLocaleMutationVariables, { cache }): string | undefined => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const previous = cache.readQuery<Codegen.GetUiStateQuery>({ query: GET_UI_STATE })!;
            const data = updateUiState(previous, 'locale', args.locale);
            cache.writeQuery({ query: GET_UI_STATE, data });
            return args.locale ?? undefined;
        },
        setContentLanguage: (
            _,
            args: Codegen.SetContentLanguageMutationVariables,
            { cache },
        ): LanguageCode => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const previous = cache.readQuery<Codegen.GetUiStateQuery>({ query: GET_UI_STATE })!;
            const data = updateUiState(previous, 'contentLanguage', args.languageCode);
            cache.writeQuery({ query: GET_UI_STATE, data });
            return args.languageCode;
        },
        setUiTheme: (_, args: Codegen.SetUiThemeMutationVariables, { cache }): string => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const previous = cache.readQuery<Codegen.GetUiStateQuery>({ query: GET_UI_STATE })!;
            const data = updateUiState(previous, 'theme', args.theme);
            cache.writeQuery({ query: GET_UI_STATE, data });
            return args.theme;
        },
        setDisplayUiExtensionPoints: (
            _,
            args: Codegen.SetDisplayUiExtensionPointsMutationVariables,
            { cache },
        ): boolean => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const previous = cache.readQuery<Codegen.GetUiStateQuery>({ query: GET_UI_STATE })!;
            const data = updateUiState(previous, 'displayUiExtensionPoints', args.display);
            cache.writeQuery({ query: GET_UI_STATE, data });
            return args.display;
        },
        setMainNavExpanded: (_, args: Codegen.SetMainNavExpandedMutationVariables, { cache }): boolean => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const previous = cache.readQuery<Codegen.GetUiStateQuery>({ query: GET_UI_STATE })!;
            const data = updateUiState(previous, 'mainNavExpanded', args.expanded);
            cache.writeQuery({ query: GET_UI_STATE, data });
            return args.expanded;
        },
        setActiveChannel: (_, args: Codegen.SetActiveChannelMutationVariables, { cache }): UserStatus => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const previous = cache.readQuery<GetUserStatusQuery>({ query: GET_USER_STATUS })!;
            const activeChannel = previous.userStatus.channels.find(c => c.id === args.channelId);
            if (!activeChannel) {
                throw new Error('setActiveChannel: Could not find Channel with ID ' + args.channelId);
            }
            const permissions = activeChannel.permissions;
            const data: { userStatus: UserStatus } = {
                userStatus: {
                    ...previous.userStatus,
                    permissions,
                    activeChannelId: activeChannel.id,
                },
            };
            cache.writeQuery({ query: GET_USER_STATUS, data });
            return data.userStatus;
        },
        updateUserChannels: (_, args: Codegen.UpdateUserChannelsMutationVariables, { cache }): UserStatus => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const previous = cache.readQuery<GetUserStatusQuery>({ query: GET_USER_STATUS })!;
            const data = {
                userStatus: {
                    ...previous.userStatus,
                    channels: Array.isArray(args.channels) ? args.channels : [args.channels],
                },
            };
            cache.writeQuery({ query: GET_USER_STATUS, data });
            return data.userStatus;
        },
    },
};

function updateUiState<K extends keyof Codegen.GetUiStateQuery['uiState']>(
    previous: Codegen.GetUiStateQuery,
    key: K,
    value: Codegen.GetUiStateQuery['uiState'][K],
): Codegen.GetUiStateQuery {
    return {
        uiState: {
            ...previous.uiState,
            [key]: value,
            __typename: 'UiState',
        },
    };
}

function updateRequestsInFlight(cache: InMemoryCache, increment: 1 | -1): number {
    const previous = cache.readQuery<Codegen.GetNetworkStatusQuery>({ query: GET_NEWTORK_STATUS });
    const inFlightRequests = previous ? previous.networkStatus.inFlightRequests + increment : increment;
    const data: Codegen.GetNetworkStatusQuery = {
        networkStatus: {
            __typename: 'NetworkStatus',
            inFlightRequests,
        },
    };
    cache.writeQuery({ query: GET_NEWTORK_STATUS, data });
    return inFlightRequests;
}
