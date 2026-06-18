import { ValueTransformer } from 'typeorm';

/**
 * Decimal types are returned as strings (e.g. "20.00") by some DBs, e.g. MySQL & Postgres
 */
export class DecimalTransformer implements ValueTransformer {
    to(value: any): any {
        return value;
    }

    from(value: any): any {
        return Number.parseFloat(value);
    }
}
