import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { Injector, NgModule, inject, provideAppInitializer } from '@angular/core';
import { ApolloClientOptions, InMemoryCache } from '@apollo/client/core';
import { setContext } from '@apollo/client/link/context';
import { ApolloLink } from '@apollo/client/link/core';
import { APOLLO_OPTIONS, Apollo, provideApollo } from 'apollo-angular';
import createUploadLink from 'apollo-upload-client/createUploadLink.mjs';

import { getAppConfig } from '../app.config';
import { introspectionResult } from '../common/introspection-result-wrapper';
import { LocalStorageService } from '../providers/local-storage/local-storage.service';

import { CheckJobsLink } from './check-jobs-link';
import { getClientDefaults } from './client-state/client-defaults';
import { clientResolvers } from './client-state/client-resolvers';
import { GET_CLIENT_STATE } from './definitions/client-definitions';
import { OmitTypenameLink } from './omit-typename-link';
import { BaseDataService } from './providers/base-data.service';
import { DataService } from './providers/data.service';
import { FetchAdapter } from './providers/fetch-adapter';
import { DefaultInterceptor } from './providers/interceptor';
import { initializeServerConfigService, ServerConfigService } from './server-config';
import { getServerLocation } from './utils/get-server-location';

export function createApollo(): ApolloClientOptions<any> {
    const localStorageService = inject(LocalStorageService);
    const fetchAdapter = inject(FetchAdapter);
    const injector = inject(Injector);
    const { adminApiPath, tokenMethod, channelTokenKey } = getAppConfig();
    const serverLocation = getServerLocation();
    const apolloCache = new InMemoryCache({
        possibleTypes: introspectionResult.possibleTypes,
        typePolicies: {
            GlobalSettings: {
                fields: {
                    serverConfig: {
                        merge: (existing, incoming) => ({ ...existing, ...incoming }),
                    },
                },
            },
            Facet: {
                fields: {
                    values: {
                        merge: (existing, incoming) => incoming,
                    },
                },
            },
        },
    });
    apolloCache.writeQuery({
        query: GET_CLIENT_STATE,
        data: getClientDefaults(localStorageService),
    });

    if (!false) {
        // TODO: enable only for dev mode
        // make the Apollo Cache inspectable in the console for debug purposes
        (window as any)['apolloCache'] = apolloCache;
    }
    return {
        link: ApolloLink.from([
            new OmitTypenameLink(),
            new CheckJobsLink(injector),
            setContext(() => {
                const headers: Record<string, string> = {};
                const channelToken = localStorageService.get('activeChannelToken');
                if (channelToken) {
                    headers[channelTokenKey ?? 'vendure-token'] = channelToken;
                }
                if (tokenMethod === 'bearer') {
                    const authToken = localStorageService.get('authToken');
                    if (authToken) {
                        headers.authorization = `Bearer ${authToken}`;
                    }
                }
                headers['Apollo-Require-Preflight'] = 'true';
                return { headers };
            }),
            createUploadLink({
                uri: `${serverLocation}/${adminApiPath}`,
                fetch: fetchAdapter.fetch,
            }),
        ]),
        cache: apolloCache,
        resolvers: clientResolvers,
    };
}

// List of all EU countries

/**
 * The DataModule is responsible for all API calls *and* serves as the source of truth for global app
 * state via the apollo-link-state package.
 */
@NgModule({
    exports: [],
    declarations: [],
    imports: [],
    providers: [
        provideApollo(createApollo),
        BaseDataService,
        DataService,
        FetchAdapter,
        ServerConfigService,
        { provide: HTTP_INTERCEPTORS, useClass: DefaultInterceptor, multi: true },
        provideAppInitializer(() => {
            const initializerFn = initializeServerConfigService(inject(ServerConfigService));
            return initializerFn();
        }),
        provideHttpClient(withInterceptorsFromDi()),
    ],
})
export class DataModule {}
