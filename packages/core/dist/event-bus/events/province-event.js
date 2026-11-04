"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProvinceEvent = void 0;
const vendure_entity_event_1 = require("../vendure-entity-event");
/**
 * @description
 * This event is fired whenever a {@link Province} is added, updated or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 2.0
 */
class ProvinceEvent extends vendure_entity_event_1.VendureEntityEvent {
    constructor(ctx, entity, type, input) {
        super(entity, type, ctx, input);
    }
}
exports.ProvinceEvent = ProvinceEvent;
//# sourceMappingURL=province-event.js.map