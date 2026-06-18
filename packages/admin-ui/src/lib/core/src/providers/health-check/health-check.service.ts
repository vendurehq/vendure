import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { merge, Observable, of, Subject, timer } from 'rxjs';
import { catchError, map, shareReplay, switchMap, throttleTime } from 'rxjs/operators';

import { getServerLocation } from '../../data/utils/get-server-location';

export type SystemStatus = 'ok' | 'error';

export interface HealthCheckResult {
    status: SystemStatus;
    info: { [name: string]: HealthCheckSuccessResult };
    details: { [name: string]: HealthCheckSuccessResult | HealthCheckErrorResult };
    error: { [name: string]: HealthCheckErrorResult };
}

export interface HealthCheckSuccessResult {
    status: 'up';
}

export interface HealthCheckErrorResult {
    status: 'down';
    message: string;
}

@Injectable({
    providedIn: 'root',
})
export class HealthCheckService {
    status$: Observable<SystemStatus>;
    details$: Observable<Array<{ key: string; result: HealthCheckSuccessResult | HealthCheckErrorResult }>>;
    lastCheck$: Observable<Date>;

    private readonly pollingDelayMs = 60 * 1000;
    private readonly healthCheckEndpoint: string;
    private readonly _refresh = new Subject<void>();

    constructor(private httpClient: HttpClient) {
        this.healthCheckEndpoint = getServerLocation() + '/health';

        const refresh$ = this._refresh.pipe(throttleTime(1000));
        const result$ = merge(timer(0, this.pollingDelayMs), refresh$).pipe(
            switchMap(() => this.checkHealth()),
            shareReplay(1),
        );

        this.status$ = result$.pipe(map(res => res.status));
        this.details$ = result$.pipe(
            map(res =>
                Object.keys(res.details).map(key => ({ key, result: res.details[key] })),
            ),
        );
        this.lastCheck$ = result$.pipe(map(res => res.lastChecked));
    }

    refresh() {
        this._refresh.next();
    }

    private checkHealth() {
        return this.httpClient.get<HealthCheckResult>(this.healthCheckEndpoint).pipe(
            catchError(err => of(err.error)),
            map(res => ({ ...res, lastChecked: new Date() })),
        );
    }
}
