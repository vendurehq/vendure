/**
 * @description
 * Registry of input types whose string fields must not be blank (empty or whitespace-only).
 * Only business-required identifier/label fields are listed here — description fields and
 * system-populated defaults are intentionally excluded.
 *
 * The `fields` array covers direct string properties on the input type.
 * The `translations` array covers string properties on each entry in the `translations` array.
 *
 * Both create and update inputs are registered because an update that explicitly sets a field
 * to blank should also be rejected, even though the field is optional on update types.
 *
 * Scope: Only top-level mutation arguments are validated. Nested input types that appear
 * inside other inputs (e.g. CreateFacetValueWithFacetInput within CreateFacetInput.values,
 * CreateGroupOptionInput within CreateProductOptionGroupInput.options) are not covered.
 * These should be validated in the service layer if needed.
 *
 * MAINTENANCE: Keep this registry in sync with the GraphQL schema definitions in
 * `packages/core/src/api/schema/admin-api/` and `packages/core/src/api/schema/shop-api/`.
 * When a new entity with required string fields is added, or an existing field is renamed,
 * this registry must be updated accordingly. Mismatches silently become no-ops (the type or
 * field won't match, so validation won't apply).
 */
export const requiredInputFields: Record<string, { fields?: string[]; translations?: string[] }> = {
    CreateProductInput: { translations: ['name', 'slug'] },
    UpdateProductInput: { translations: ['name', 'slug'] },

    CreateProductVariantInput: { fields: ['sku'], translations: ['name'] },
    UpdateProductVariantInput: { fields: ['sku'], translations: ['name'] },

    CreateProductOptionInput: { fields: ['code'], translations: ['name'] },
    UpdateProductOptionInput: { fields: ['code'], translations: ['name'] },
    CreateProductOptionGroupInput: { fields: ['code'], translations: ['name'] },
    UpdateProductOptionGroupInput: { fields: ['code'], translations: ['name'] },

    CreateFacetInput: { fields: ['code'], translations: ['name'] },
    UpdateFacetInput: { fields: ['code'], translations: ['name'] },
    CreateFacetValueInput: { fields: ['code'], translations: ['name'] },
    UpdateFacetValueInput: { fields: ['code'], translations: ['name'] },

    CreateCollectionInput: { translations: ['name', 'slug'] },
    UpdateCollectionInput: { translations: ['name', 'slug'] },

    CreateChannelInput: { fields: ['code', 'token'] },
    UpdateChannelInput: { fields: ['code', 'token'] },

    CreateShippingMethodInput: { fields: ['code', 'fulfillmentHandler'], translations: ['name'] },
    UpdateShippingMethodInput: { fields: ['code', 'fulfillmentHandler'], translations: ['name'] },

    CreatePaymentMethodInput: { fields: ['code'], translations: ['name'] },
    UpdatePaymentMethodInput: { fields: ['code'], translations: ['name'] },

    CreateTaxCategoryInput: { fields: ['name'] },
    UpdateTaxCategoryInput: { fields: ['name'] },
    CreateTaxRateInput: { fields: ['name'] },
    UpdateTaxRateInput: { fields: ['name'] },

    CreateRoleInput: { fields: ['code'] },
    UpdateRoleInput: { fields: ['code'] },

    CreateZoneInput: { fields: ['name'] },
    UpdateZoneInput: { fields: ['name'] },

    CreateCountryInput: { fields: ['code'], translations: ['name'] },
    UpdateCountryInput: { fields: ['code'], translations: ['name'] },
    CreateProvinceInput: { fields: ['code'], translations: ['name'] },
    UpdateProvinceInput: { fields: ['code'], translations: ['name'] },

    CreateSellerInput: { fields: ['name'] },
    UpdateSellerInput: { fields: ['name'] },

    CreateStockLocationInput: { fields: ['name'] },
    UpdateStockLocationInput: { fields: ['name'] },

    CreateAdministratorInput: { fields: ['firstName', 'lastName', 'emailAddress'] },
    UpdateAdministratorInput: { fields: ['firstName', 'lastName', 'emailAddress'] },
    UpdateActiveAdministratorInput: { fields: ['firstName', 'lastName', 'emailAddress'] },

    CreateCustomerInput: { fields: ['firstName', 'lastName', 'emailAddress'] },
    UpdateCustomerInput: { fields: ['firstName', 'lastName', 'emailAddress'] },

    CreateCustomerGroupInput: { fields: ['name'] },
    UpdateCustomerGroupInput: { fields: ['name'] },

    CreatePromotionInput: { translations: ['name'] },
    UpdatePromotionInput: { translations: ['name'] },

    CreateTagInput: { fields: ['value'] },
    UpdateTagInput: { fields: ['value'] },

    CreateAddressInput: { fields: ['streetLine1'] },
    UpdateAddressInput: { fields: ['streetLine1'] },

    RegisterCustomerInput: { fields: ['emailAddress'] },
    PaymentInput: { fields: ['method'] },
};
