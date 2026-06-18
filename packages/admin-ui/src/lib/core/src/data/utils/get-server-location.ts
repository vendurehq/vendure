import { getAppConfig } from '../../app.config';

/**
 * Returns the location of the server, e.g. "http://localhost:3000"
 */
export function getServerLocation(): string {
    const { apiHost, apiPort, adminApiPath, tokenMethod } = getAppConfig();
    const host = apiHost === 'auto' ? `${location.protocol}//${location.hostname}` : apiHost;
    const port = apiPort
        ? apiPort === 'auto'
            ? location.port === ''
                ? ''
                : `:${location.port}`
            : `:${apiPort}`
        : '';
    return `${host}${port}`;
}
