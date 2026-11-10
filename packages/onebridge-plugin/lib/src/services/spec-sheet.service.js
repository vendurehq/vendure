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
exports.OnebridgeSpecSheetService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const channel_context_1 = require("./channel-context");
let OnebridgeSpecSheetService = class OnebridgeSpecSheetService {
    constructor(productService, productVariantService) {
        this.productService = productService;
        this.productVariantService = productVariantService;
    }
    async list(ctx, options) {
        var _a, _b, _c;
        (0, channel_context_1.resolveChannelToken)(ctx);
        const take = Math.min(100, Math.max(1, (_a = options === null || options === void 0 ? void 0 : options.take) !== null && _a !== void 0 ? _a : 50));
        const { items } = await this.productService.findAll(ctx, {
            take,
            filter: { enabled: { eq: true }, spec: { notEq: '' } },
            sort: { createdAt: 'ASC' },
        }, ['variants']);
        const sheets = [];
        for (const product of items) {
            const customFields = ((_b = product.customFields) !== null && _b !== void 0 ? _b : {});
            const spec = this.text(customFields.spec);
            if (!spec)
                continue;
            const firstVariant = (_c = product.variants) === null || _c === void 0 ? void 0 : _c[0];
            let price = null;
            if (firstVariant) {
                try {
                    price = await this.productVariantService.hydratePriceFields(ctx, firstVariant, 'priceWithTax');
                }
                catch (_d) {
                    price = null;
                }
            }
            sheets.push({
                slug: product.slug,
                krName: this.text(customFields.krName) || product.name || product.slug,
                spec,
                moq: typeof customFields.moq === 'number' ? customFields.moq : null,
                leadTime: this.text(customFields.leadTime),
                price,
            });
        }
        return sheets;
    }
    text(value) {
        return typeof value === 'string' ? value.trim() : '';
    }
};
exports.OnebridgeSpecSheetService = OnebridgeSpecSheetService;
exports.OnebridgeSpecSheetService = OnebridgeSpecSheetService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.ProductService,
        core_1.ProductVariantService])
], OnebridgeSpecSheetService);
//# sourceMappingURL=spec-sheet.service.js.map