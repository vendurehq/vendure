import { ObjectLiteral } from 'typeorm';
import { OrmUtils } from 'typeorm/util/OrmUtils';

let patchApplied = false;

/**
 * Works around a TypeORM bug which throws when find options are resolved for a relation that
 * lives inside an embedded entity, and the find options do not mention that embedded entity.
 * Every relation custom field is such a relation, e.g. `customFields.owner` on Product.
 *
 * `OrmUtils.deepValue()` walks a dotted property path over an object and returns the value at
 * the end of it. It reads each segment without checking that the previous one resolved to
 * anything, so `deepValue({ featuredAsset: true }, 'customFields.owner')` reads `owner` of
 * `undefined` and throws instead of returning `undefined`.
 *
 * `SelectQueryBuilder` calls it in seven places to narrow the `select`, `order` and `relations`
 * options down to the part that applies to one relation, in each case treating a missing path
 * as "nothing specified for this relation". The call which brings the throw into an ordinary
 * query is the one in the `relationLoadStrategy: 'query'` eager loading branch, which runs for
 * every eager relation of the entity being queried whenever any find options are set. So a
 * query for a Product with a `relations` object that does not name `customFields` fails
 * outright once an eager relation custom field is configured.
 *
 * The implementation below is the original with a guard added for a nullish intermediate
 * segment, which is what every call site already expects.
 *
 * Reported upstream as https://github.com/typeorm/typeorm/issues/12774. This workaround can be
 * removed once the minimum supported TypeORM version contains a fix.
 */
export function patchTypeOrmDeepValue() {
    if (patchApplied) {
        return;
    }
    patchApplied = true;

    OrmUtils.deepValue = function (obj: ObjectLiteral, path: string): any {
        let value: any = obj;
        for (const segment of path.split('.')) {
            if (value == null) {
                return undefined;
            }
            value = value[segment];
        }
        return value;
    };
}
