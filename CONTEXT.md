# Vendure

Vendure models commerce configuration and operational data shared by its Admin and Shop APIs.

## Language

**Library Asset**:
An Asset discoverable through ordinary Asset queries and available for catalog relationships.

**System Asset**:
An Asset used by an internal feature and omitted from ordinary Asset queries. A System Asset is managed through the operation which owns it. This classification does not control access to the underlying storage URL.

**Shipping Option**:
One priced choice offered by a ShippingMethod, such as a carrier service. A ShippingCalculator that returns a single result offers one Shipping Option, whose code is null unless the calculator gives it one. The chosen Shipping Option is identified by its code, which is stored on the ShippingLine.
