import fs from 'fs-extra';
import http from 'http';
import https from 'https';
import path from 'path';
import { from, lastValueFrom } from 'rxjs';
import { delay, retryWhen, take, tap } from 'rxjs/operators';
import { Readable } from 'stream';
import { URL } from 'url';

import { Injector } from '../../common/injector';
import { ConfigService } from '../config.service';
import { Logger } from '../logger/vendure-logger';

import { assertPublicUrl, PinnedAddress } from './assert-public-url';
import { AssetImportStrategy } from './asset-import-strategy';

const loggerCtx = 'DefaultAssetImportStrategy';
const MAX_LOGGED_URL_LENGTH = 200;

function safeForLog(value: string): string {
    return value.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, MAX_LOGGED_URL_LENGTH);
}

/**
 * Issues an HTTP(S) GET for the asset. If `pinned` is provided, the request is
 * directed at that exact IP address with the original hostname preserved in the
 * `Host` header (and as the TLS SNI `servername` for HTTPS). This avoids a
 * second, independent DNS lookup that could resolve the hostname to a private
 * IP between {@link assertPublicUrl} validation and this fetch (DNS rebinding).
 *
 * The implementation deliberately does NOT follow redirects — Node's default.
 * Enabling redirect-following here would re-open the SSRF surface that this
 * file is meant to close, because the redirect target would bypass the
 * `assertPublicUrl` validation.
 */
function fetchUrl(url: URL, pinned: PinnedAddress | null): Promise<Readable> {
    return new Promise((resolve, reject) => {
        const isHttps = url.protocol === 'https:';
        const get = isHttps ? https.get : http.get;
        const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
        // `url.host` preserves the port only when it is non-default, which is
        // exactly what we want for the Host header.
        const hostHeader = url.host;
        const requestOptions: http.RequestOptions = pinned
            ? {
                  host: pinned.address,
                  port,
                  path: `${url.pathname}${url.search}`,
                  family: pinned.family,
                  headers: { Host: hostHeader },
                  timeout: 5000,
              }
            : {
                  // No pinned IP: caller opted into `allowPrivateNetworks`, fall
                  // back to the URL-driven path. Node performs its own DNS lookup
                  // here, which is fine because the operator has accepted the
                  // private-network risk.
                  host: url.hostname,
                  port,
                  path: `${url.pathname}${url.search}`,
                  headers: { Host: hostHeader },
                  timeout: 5000,
              };
        if (isHttps && pinned) {
            (requestOptions as https.RequestOptions).servername = url.hostname;
        }
        get(requestOptions, res => {
            const { statusCode } = res;
            if (statusCode !== 200) {
                Logger.error(
                    `Failed to fetch "${safeForLog(url.toString())}", statusCode: ${statusCode ?? 'unknown'}`,
                    loggerCtx,
                );
                reject(new Error(`Request failed. Status code: ${statusCode ?? 'unknown'}`));
            } else {
                resolve(res);
            }
        }).on('error', err => reject(err));
    });
}

/**
 * @description
 * Options for {@link DefaultAssetImportStrategy}.
 *
 * @since 1.7.0
 * @docsCategory import-export
 */
export interface DefaultAssetImportStrategyOptions {
    /**
     * @description
     * Delay between retries when a fetch fails, in milliseconds.
     *
     * @default 200
     */
    retryDelayMs?: number;
    /**
     * @description
     * Maximum number of retries when a fetch fails.
     *
     * @default 3
     */
    retryCount?: number;
    /**
     * @description
     * If `true`, the strategy permits fetching from hostnames that resolve to
     * private, loopback, link-local or other non-public IP addresses. The
     * default `false` rejects such hostnames in order to mitigate server-side
     * request forgery against the host's internal network and cloud metadata
     * services. Enable only when importing from a trusted internal asset
     * server or for local development.
     *
     * @default false
     * @since 3.6.4
     */
    allowPrivateNetworks?: boolean;
}

/**
 * @description
 * The DefaultAssetImportStrategy is able to import paths from the local filesystem (taking into account the
 * `importExportOptions.importAssetsDir` setting) as well as remote http/https urls.
 *
 * @since 1.7.0
 * @docsCategory import-export
 */
export class DefaultAssetImportStrategy implements AssetImportStrategy {
    private configService: ConfigService;

    constructor(private options?: DefaultAssetImportStrategyOptions) {}

    init(injector: Injector) {
        this.configService = injector.get(ConfigService);
    }

    getStreamFromPath(assetPath: string) {
        if (/^https?:\/\//.test(assetPath)) {
            return this.getStreamFromUrl(assetPath);
        } else {
            return this.getStreamFromLocalFile(assetPath);
        }
    }

    private async getStreamFromUrl(assetUrl: string): Promise<Readable> {
        const { retryCount, retryDelayMs, allowPrivateNetworks } = this.options ?? {};
        const { url, pinned } = await assertPublicUrl(assetUrl, { allowPrivateNetworks });
        return lastValueFrom(
            from(fetchUrl(url, pinned)).pipe(
                retryWhen(errors =>
                    errors.pipe(
                        tap(value => {
                            Logger.verbose(String(value), loggerCtx);
                            Logger.verbose(`retrying fetchUrl for ${safeForLog(assetUrl)}`, loggerCtx);
                        }),
                        delay(retryDelayMs ?? 200),
                        take(retryCount ?? 3),
                    ),
                ),
            ),
        );
    }

    private getStreamFromLocalFile(assetPath: string): Readable {
        const { importAssetsDir } = this.configService.importExportOptions;
        const filename = path.join(importAssetsDir, assetPath);

        if (fs.existsSync(filename)) {
            const fileStat = fs.statSync(filename);
            if (fileStat.isFile()) {
                try {
                    const stream = fs.createReadStream(filename);
                    return stream;
                } catch (err) {
                    throw err;
                }
            } else {
                throw new Error(`Could not find file "${filename}"`);
            }
        } else {
            throw new Error(`File "${filename}" does not exist`);
        }
    }
}
