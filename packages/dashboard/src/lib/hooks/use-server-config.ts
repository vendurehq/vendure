import { ServerConfigContext } from '@/vdb/providers/server-config.js';
import React from 'react';

export const useServerConfig = () => React.useContext(ServerConfigContext);

/**
 * @description
 * Returns whether the server config has been loaded yet. Useful for
 * distinguishing "loading" from "no value configured" so callers can render
 * a skeleton instead of nothing while the initial server config request is
 * in flight.
 *
 * @docsCategory hooks
 * @since 3.6.4
 */
export const useIsServerConfigLoaded = (): boolean => useServerConfig() != null;
