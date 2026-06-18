import { Injectable } from '@angular/core';
import { ServerConfigService } from '../../data/server-config';

@Injectable({
    providedIn: 'root',
})
export class CurrencyService {
    readonly precision: number;
    readonly precisionFactor: number;
    constructor(serverConfigService: ServerConfigService) {
        this.precision = serverConfigService.serverConfig.moneyStrategyPrecision;
        this.precisionFactor = Math.pow(10, this.precision);
    }

    toMajorUnits(value: number): number {
        return value / this.precisionFactor;
    }
}
