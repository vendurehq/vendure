import { Injectable } from '@nestjs/common';
import { ConfigService } from '@vendure/core';

/**
 * This service is responsible for providing GraphiQL configuration
 * and a fallback UI if needed.
 */
@Injectable()
export class GraphiQLService {
    constructor(private configService: ConfigService) {}

    /**
     * Get the Admin API URL
     */
    getAdminApiUrl(): string {
        const adminApiPath = this.configService.apiOptions.adminApiPath || 'admin-api';
        return this.createApiUrl(adminApiPath);
    }

    /**
     * Get the Shop API URL
     */
    getShopApiUrl(): string {
        const shopApiPath = this.configService.apiOptions.shopApiPath || 'shop-api';
        return this.createApiUrl(shopApiPath);
    }

    /**
     * Create a fully-qualified API URL
     */
    private createApiUrl(apiPath: string): string {
        // Get API host and port from the config
        const apiHost = this.configService.apiOptions.hostname || '';
        const apiPort = this.configService.apiOptions.port || '';

        const host = apiHost || '';
        const port = apiPort ? `:${apiPort}` : '';
        const pathUrl = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;

        // If the host is specified, create a fully-qualified URL
        if (host) {
            const protocol = host.startsWith('https') ? '' : 'http://';
            return `${protocol}${host}${port}${pathUrl}`;
        }

        // Otherwise use a relative URL
        return pathUrl;
    }
}
