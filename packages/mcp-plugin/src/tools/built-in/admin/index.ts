import { AddCustomerToGroupTool } from './add-customer-to-group.tool';
import { AddNoteToOrderTool } from './add-note-to-order.tool';
import { AdjustStockTool } from './adjust-stock.tool';
import { CancelOrderTool } from './cancel-order.tool';
import { CheckStoreTool } from './check-store.tool';
import { CreateChannelTool } from './create-channel.tool';
import { CreateCustomerTool } from './create-customer.tool';
import { CreateFulfillmentTool } from './create-fulfillment.tool';
import { CreatePaymentMethodTool } from './create-payment-method.tool';
import { CreateProductTool } from './create-product.tool';
import { CreateRoleTool } from './create-role.tool';
import { CreateShippingMethodTool } from './create-shipping-method.tool';
import { CreateStockLocationTool } from './create-stock-location.tool';
import { CreateTaxCategoryTool } from './create-tax-category.tool';
import { CreateTaxRateTool } from './create-tax-rate.tool';
import { CreateVariantTool } from './create-variant.tool';
import { CreateZoneTool } from './create-zone.tool';
import { DeleteChannelTool } from './delete-channel.tool';
import { DeletePaymentMethodTool } from './delete-payment-method.tool';
import { DeleteRoleTool } from './delete-role.tool';
import { DeleteShippingMethodTool } from './delete-shipping-method.tool';
import { DeleteStockLocationTool } from './delete-stock-location.tool';
import { DeleteTaxCategoryTool } from './delete-tax-category.tool';
import { DeleteTaxRateTool } from './delete-tax-rate.tool';
import { DeleteZoneTool } from './delete-zone.tool';
import { EnableCountriesTool } from './enable-countries.tool';
import { GetChannelTool } from './get-channel.tool';
import { GetCustomerTool } from './get-customer.tool';
import { AdminGetOrderTool } from './get-order.tool';
import { AdminGetProductTool } from './get-product.tool';
import { GetSettingTool } from './get-setting.tool';
import { GetStockLevelsTool } from './get-stock-levels.tool';
import { ListChannelsTool } from './list-channels.tool';
import { ListCountriesTool } from './list-countries.tool';
import { ListCustomerGroupsTool } from './list-customer-groups.tool';
import { ListCustomersTool } from './list-customers.tool';
import { ListOrdersTool } from './list-orders.tool';
import { ListPaymentMethodsTool } from './list-payment-methods.tool';
import { ListPaymentOptionsTool } from './list-payment-options.tool';
import { ListProductsTool } from './list-products.tool';
import { ListRolesTool } from './list-roles.tool';
import { ListShippingMethodsTool } from './list-shipping-methods.tool';
import { ListShippingOptionsTool } from './list-shipping-options.tool';
import { ListStockLocationsTool } from './list-stock-locations.tool';
import { ListTaxCategoriesTool } from './list-tax-categories.tool';
import { ListTaxRatesTool } from './list-tax-rates.tool';
import { ListZonesTool } from './list-zones.tool';
import { RefundOrderTool } from './refund-order.tool';
import { SetActiveChannelTool } from './set-active-channel.tool';
import { SetSettingTool } from './set-setting.tool';
import { UpdateChannelTool } from './update-channel.tool';
import { UpdateCustomerTool } from './update-customer.tool';
import { UpdateOrderStateTool } from './update-order-state.tool';
import { UpdatePaymentMethodTool } from './update-payment-method.tool';
import { UpdateProductTool } from './update-product.tool';
import { UpdateRoleTool } from './update-role.tool';
import { UpdateShippingMethodTool } from './update-shipping-method.tool';
import { UpdateStockLocationTool } from './update-stock-location.tool';
import { UpdateTaxCategoryTool } from './update-tax-category.tool';
import { UpdateTaxRateTool } from './update-tax-rate.tool';
import { UpdateVariantTool } from './update-variant.tool';
import { UpdateZoneTool } from './update-zone.tool';
import { UploadAssetTool } from './upload-asset.tool';

export const adminToolProviders = [
    ListOrdersTool,
    AdminGetOrderTool,
    UpdateOrderStateTool,
    CancelOrderTool,
    RefundOrderTool,
    AddNoteToOrderTool,
    CreateFulfillmentTool,
    ListCustomersTool,
    GetCustomerTool,
    CreateCustomerTool,
    UpdateCustomerTool,
    AddCustomerToGroupTool,
    ListCustomerGroupsTool,
    ListProductsTool,
    AdminGetProductTool,
    CreateProductTool,
    UpdateProductTool,
    CreateVariantTool,
    UpdateVariantTool,
    UploadAssetTool,
    GetStockLevelsTool,
    AdjustStockTool,
    ListChannelsTool,
    SetActiveChannelTool,
    // Store setup
    GetChannelTool,
    CreateChannelTool,
    UpdateChannelTool,
    DeleteChannelTool,
    ListZonesTool,
    CreateZoneTool,
    UpdateZoneTool,
    DeleteZoneTool,
    ListCountriesTool,
    EnableCountriesTool,
    ListTaxCategoriesTool,
    CreateTaxCategoryTool,
    UpdateTaxCategoryTool,
    DeleteTaxCategoryTool,
    ListTaxRatesTool,
    CreateTaxRateTool,
    UpdateTaxRateTool,
    DeleteTaxRateTool,
    ListShippingMethodsTool,
    CreateShippingMethodTool,
    UpdateShippingMethodTool,
    DeleteShippingMethodTool,
    ListShippingOptionsTool,
    ListPaymentMethodsTool,
    CreatePaymentMethodTool,
    UpdatePaymentMethodTool,
    DeletePaymentMethodTool,
    ListPaymentOptionsTool,
    ListStockLocationsTool,
    CreateStockLocationTool,
    UpdateStockLocationTool,
    DeleteStockLocationTool,
    ListRolesTool,
    CreateRoleTool,
    UpdateRoleTool,
    DeleteRoleTool,
    GetSettingTool,
    SetSettingTool,
    CheckStoreTool,
];
