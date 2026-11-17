import { createGraphiQLFetcher } from '@graphiql/toolkit';
import { GraphiQL } from 'graphiql';
import 'graphiql/graphiql.css';
import './overrides.css';
import React, { useCallback } from 'react';
import { embeddedModeStorage } from './embedded-mode-storage';

interface AppProps {
    apiType: 'admin' | 'shop';
}

const App: React.FC<AppProps> = ({ apiType }) => {
    const { adminApiUrl, shopApiUrl } = window.GRAPHIQL_SETTINGS ?? {
        adminApiUrl: 'http://localhost:3000/admin-api',
        shopApiUrl: 'http://localhost:3000/shop-api',
    };
    const apiUrl = apiType === 'admin' ? adminApiUrl : shopApiUrl;
    const apiName = apiType === 'admin' ? 'Admin API' : 'Shop API';

    const params = new URLSearchParams(window.location.search);
    const query = params.get('query') ?? undefined;
    const embeddedMode = params.get('embeddedMode') === 'true';
    const storage = embeddedMode ? embeddedModeStorage : undefined;

    const fetcher = useCallback(() => {
        // The API URL is relative to the page, so the WebSocket URL is built from the page's own location.
        const subscriptionUrl = new URL(apiUrl, window.location.href);
        subscriptionUrl.protocol = subscriptionUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        return createGraphiQLFetcher({
            url: apiUrl,
            subscriptionUrl: subscriptionUrl.href,
        });
    }, [apiUrl]);

    const handleSwitchApi = (newApiType: 'admin' | 'shop') => {
        if (newApiType !== apiType) {
            // Replace the last path segment, so a route with several segments keeps its prefix.
            // A path without it (e.g. the Vite dev server at `/`) gets the segment appended.
            const { pathname } = window.location;
            const apiSuffix = /\/(admin|shop)\/?$/;
            window.location.href = apiSuffix.test(pathname)
                ? pathname.replace(apiSuffix, `/${newApiType}`)
                : `${pathname.replace(/\/$/, '')}/${newApiType}`;
        }
    };

    return (
        <div className="graphiql-app">
            {!embeddedMode ? <div className="vendure-header">
                <h1>Vendure GraphiQL - {apiName}</h1>
                <div className="switch-api">
                    <span>Switch API:</span>
                    <a
                        href="#"
                        className={apiType === 'admin' ? 'active' : ''}
                        onClick={e => {
                            e.preventDefault();
                            handleSwitchApi('admin');
                        }}
                    >
                        Admin API
                    </a>
                    <a
                        href="#"
                        className={apiType === 'shop' ? 'active' : ''}
                        onClick={e => {
                            e.preventDefault();
                            handleSwitchApi('shop');
                        }}
                    >
                        Shop API
                    </a>
                </div>
            </div> : null}
            <div className="graphiql-wrapper">
                <GraphiQL className={embeddedMode ? 'embedded-mode' : undefined} fetcher={fetcher()} storage={storage}
                          defaultEditorToolsVisibility={embeddedMode ? false : true} query={query} />
            </div>
        </div>
    );
};

export default App;
