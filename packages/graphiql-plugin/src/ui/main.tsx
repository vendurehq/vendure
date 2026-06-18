import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './styles.css';

// Check for embedded mode and apply body classes
const params = new URLSearchParams(window.location.search);
const embeddedMode = params.get('embeddedMode') === 'true';

if (embeddedMode) {
    document.body.classList.add('embedded-mode', 'graphiql-dark');
}

// Get the API URL and name from the URL path
const path = window.location.pathname;
const isAdminApi = path.includes('/admin');
const isShopApi = path.includes('/shop');

// Default to admin API if no specific path is found
const apiType = isShopApi ? 'shop' : 'admin';

// Read the server-provided API URLs from the window object
declare global {
    interface Window {
        GRAPHIQL_SETTINGS: {
            adminApiUrl: string;
            shopApiUrl: string;
        };
    }
}

const rootElement = document.getElementById('root');
if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
            <App apiType={apiType} />
        </React.StrictMode>,
    );
}
