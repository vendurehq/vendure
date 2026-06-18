import { Injectable, OnModuleDestroy } from '@nestjs/common';
import express from 'express';
import http from 'http';

import { Logger } from '../config/logger/vendure-logger';

/**
 * @description
 * Specifies the configuration for the Worker's HTTP health check endpoint.
 *
 * @since 1.2.0
 * @docsCategory worker
 */
export interface WorkerHealthCheckConfig {
    /**
     * @description
     * The port on which the worker will listen
     */
    port: number;
    /**
     * @description
     * The hostname
     *
     * @default 'localhost'
     */
    hostname?: string;
    /**
     * @description
     * The route at which the health check is available.
     *
     * @default '/health'
     */
    route?: string;
}

@Injectable()
export class WorkerHealthService implements OnModuleDestroy {
    private server: http.Server | undefined;

    initializeHealthCheckEndpoint(config: WorkerHealthCheckConfig): Promise<void> {
        const { port, hostname, route } = config;
        const healthRoute = route || '/health';
        const app = express();
        const server = http.createServer(app);
        app.get(healthRoute, (req, res) => {
            res.send({
                status: 'ok',
            });
        });
        this.server = server;
        return new Promise((resolve, reject) => {
            server.on('error', err => {
                Logger.error(`Failed to start worker health endpoint server (${err.toString()})`);
                reject(err);
            });
            server.on('listening', () => {
                const endpointUrl = `http://${hostname || 'localhost'}:${port}${healthRoute}`;
                Logger.info(`Worker health check endpoint: ${endpointUrl}`);
                resolve();
            });
            server.listen(port, hostname || '');
        });
    }

    onModuleDestroy(): any {
        return new Promise<void>(resolve => {
            if (this.server) {
                this.server.close(() => resolve());
            } else {
                resolve();
            }
        });
    }
}
