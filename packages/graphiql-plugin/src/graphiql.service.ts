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
     * The API path relative to the site root. The page uses it as-is, so the browser sends its
     * requests to the server that served the page. `apiOptions.hostname` is the address the
     * server listens on (e.g. `0.0.0.0` in Docker), not one a browser can reach, so it is not used.
     */
    private createApiUrl(apiPath: string): string {
        return apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    }
}
