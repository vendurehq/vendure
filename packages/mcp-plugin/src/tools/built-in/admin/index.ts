import { AddCustomerToGroupTool } from './add-customer-to-group.tool';
import { AddNoteToOrderTool } from './add-note-to-order.tool';
import { AdjustStockTool } from './adjust-stock.tool';
import { CancelOrderTool } from './cancel-order.tool';
import { CreateCustomerTool } from './create-customer.tool';
import { CreateProductTool } from './create-product.tool';
import { CreateVariantTool } from './create-variant.tool';
import { GetCustomerTool } from './get-customer.tool';
import { AdminGetOrderTool } from './get-order.tool';
import { AdminGetProductTool } from './get-product.tool';
import { GetStockLevelsTool } from './get-stock-levels.tool';
import { ListChannelsTool } from './list-channels.tool';
import { ListCustomerGroupsTool } from './list-customer-groups.tool';
import { ListCustomersTool } from './list-customers.tool';
import { ListOrdersTool } from './list-orders.tool';
import { ListProductsTool } from './list-products.tool';
import { RefundOrderTool } from './refund-order.tool';
import { SetActiveChannelTool } from './set-active-channel.tool';
import { UpdateCustomerTool } from './update-customer.tool';
import { UpdateOrderStateTool } from './update-order-state.tool';
import { UpdateProductAssetsTool } from './update-product-assets.tool';
import { UpdateProductTool } from './update-product.tool';
import { UpdateVariantTool } from './update-variant.tool';
import { UploadAssetTool } from './upload-asset.tool';

export const adminToolProviders = [
    ListOrdersTool,
    AdminGetOrderTool,
    UpdateOrderStateTool,
    CancelOrderTool,
    RefundOrderTool,
    AddNoteToOrderTool,
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
    UpdateProductAssetsTool,
    UploadAssetTool,
    GetStockLevelsTool,
    AdjustStockTool,
    ListChannelsTool,
    SetActiveChannelTool,
];
