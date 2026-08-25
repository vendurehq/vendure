import { AddToCartTool } from './add-to-cart.tool';
import { ApplyCouponCodeTool } from './apply-coupon-code.tool';
import { GetCartTool } from './get-cart.tool';
import { ShopGetCollectionTool } from './get-collection.tool';
import { GetEligiblePaymentMethodsTool } from './get-eligible-payment-methods.tool';
import { GetEligibleShippingMethodsTool } from './get-eligible-shipping-methods.tool';
import { GetMyAccountTool } from './get-my-account.tool';
import { ShopGetOrderTool } from './get-order.tool';
import { ShopGetProductTool } from './get-product.tool';
import { ShopListCollectionsTool } from './list-collections.tool';
import { ListMyOrdersTool } from './list-my-orders.tool';
import { PlaceOrderTool } from './place-order.tool';
import { RemoveCouponCodeTool } from './remove-coupon-code.tool';
import { RemoveFromCartTool } from './remove-from-cart.tool';
import { SearchProductsTool } from './search-products.tool';
import { SetCheckoutAddressesTool } from './set-checkout-addresses.tool';
import { SetShippingMethodTool } from './set-shipping-method.tool';
import { UpdateCartLineTool } from './update-cart-line.tool';

export const shopToolProviders = [
    SearchProductsTool,
    ShopListCollectionsTool,
    ShopGetCollectionTool,
    ShopGetProductTool,
    GetCartTool,
    GetEligiblePaymentMethodsTool,
    GetEligibleShippingMethodsTool,
    AddToCartTool,
    UpdateCartLineTool,
    RemoveFromCartTool,
    ApplyCouponCodeTool,
    RemoveCouponCodeTool,
    SetCheckoutAddressesTool,
    SetShippingMethodTool,
    PlaceOrderTool,
    ShopGetOrderTool,
    GetMyAccountTool,
    ListMyOrdersTool,
];
