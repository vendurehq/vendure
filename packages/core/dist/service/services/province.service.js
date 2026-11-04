"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProvinceService = void 0;
const common_1 = require("@nestjs/common");
const generated_types_1 = require("@vendure/common/lib/generated-types");
const instrument_decorator_1 = require("../../common/instrument-decorator");
const utils_1 = require("../../common/utils");
const transactional_connection_1 = require("../../connection/transactional-connection");
const province_entity_1 = require("../../entity/region/province.entity");
const region_translation_entity_1 = require("../../entity/region/region-translation.entity");
const event_bus_1 = require("../../event-bus");
const province_event_1 = require("../../event-bus/events/province-event");
const list_query_builder_1 = require("../helpers/list-query-builder/list-query-builder");
const translatable_saver_1 = require("../helpers/translatable-saver/translatable-saver");
const translator_service_1 = require("../helpers/translator/translator.service");
/**
 * @description
 * Contains methods relating to {@link Province} entities.
 *
 * @docsCategory services
 */
let ProvinceService = class ProvinceService {
    constructor(connection, listQueryBuilder, translatableSaver, eventBus, translator) {
        this.connection = connection;
        this.listQueryBuilder = listQueryBuilder;
        this.translatableSaver = translatableSaver;
        this.eventBus = eventBus;
        this.translator = translator;
    }
    findAll(ctx, options, relations = []) {
        return this.listQueryBuilder
            .build(province_entity_1.Province, options, { ctx, relations })
            .getManyAndCount()
            .then(([provinces, totalItems]) => {
            const items = provinces.map(province => this.translator.translate(province, ctx));
            return {
                items,
                totalItems,
            };
        });
    }
    findOne(ctx, provinceId, relations = []) {
        return this.connection
            .getRepository(ctx, province_entity_1.Province)
            .findOne({ where: { id: provinceId }, relations })
            .then(province => { var _a; return (_a = (province && this.translator.translate(province, ctx))) !== null && _a !== void 0 ? _a : undefined; });
    }
    async create(ctx, input) {
        const province = await this.translatableSaver.create({
            ctx,
            input,
            entityType: province_entity_1.Province,
            translationType: region_translation_entity_1.RegionTranslation,
        });
        await this.eventBus.publish(new province_event_1.ProvinceEvent(ctx, province, 'created', input));
        return (0, utils_1.assertFound)(this.findOne(ctx, province.id));
    }
    async update(ctx, input) {
        const province = await this.translatableSaver.update({
            ctx,
            input,
            entityType: province_entity_1.Province,
            translationType: region_translation_entity_1.RegionTranslation,
        });
        await this.eventBus.publish(new province_event_1.ProvinceEvent(ctx, province, 'updated', input));
        return (0, utils_1.assertFound)(this.findOne(ctx, province.id));
    }
    async delete(ctx, id) {
        const region = await this.connection.getEntityOrThrow(ctx, province_entity_1.Province, id);
        const deletedProvince = new province_entity_1.Province(region);
        await this.connection.getRepository(ctx, province_entity_1.Province).remove(region);
        await this.eventBus.publish(new province_event_1.ProvinceEvent(ctx, deletedProvince, 'deleted', id));
        return {
            result: generated_types_1.DeletionResult.DELETED,
            message: '',
        };
    }
};
exports.ProvinceService = ProvinceService;
exports.ProvinceService = ProvinceService = __decorate([
    (0, common_1.Injectable)(),
    (0, instrument_decorator_1.Instrument)(),
    __metadata("design:paramtypes", [transactional_connection_1.TransactionalConnection,
        list_query_builder_1.ListQueryBuilder,
        translatable_saver_1.TranslatableSaver,
        event_bus_1.EventBus,
        translator_service_1.TranslatorService])
], ProvinceService);
//# sourceMappingURL=province.service.js.map