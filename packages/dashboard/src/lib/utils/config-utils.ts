import { uiConfig } from 'virtual:vendure-ui-config';

/**
 * Returns the base URL for API requests based on the configuration.
 * Respects the 'auto' setting to derive the URL from the current location.
 *
 * @returns {string} The constructed API base URL, e.g. https://api.example.test:3070
 */
export function getApiBaseUrl(): string {
    const schemeAndHost =
        uiConfig.api.host !== 'auto'
            ? uiConfig.api.host
            : `${globalThis.location.protocol}//${globalThis.location.hostname}`;

    const locationPortPart = globalThis.location.port ? `:${globalThis.location.port}` : '';
    const portPart = uiConfig.api.port === 'auto' ? locationPortPart : `:${uiConfig.api.port}`;

    return schemeAndHost + portPart;
}
