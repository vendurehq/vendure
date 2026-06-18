import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Textarea } from '@/vdb/components/ui/textarea.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RouterContextProvider } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { createDemoRoute } from '../../../../.storybook/providers.js';
import {
    DetailFormGrid,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
} from './page-layout.js';

// Sample GraphQL query for a product detail
const productFragment = graphql(`
    fragment ProductDetailForForm on Product {
        id
        createdAt
        updatedAt
        name
        slug
        description
        enabled
    }
`);

const productQuery = graphql(
    `
        query ProductForCustomForm($id: ID!) {
            product(id: $id) {
                ...ProductDetailForForm
            }
        }
    `,
    [productFragment],
);

interface ProductFormData {
    name: string;
    slug: string;
    description: string;
    enabled: boolean;
}

const meta = {
    title: 'Layout/Custom Form Page',
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * This example shows how to create a custom form page using FormFieldWrapper
 * with a product entity. This pattern is useful when you want full control over
 * the form layout instead of using the automated DetailPage component.
 */
export const ProductCustomForm: Story = {
    render: () => {
        const { route, router } = createDemoRoute();
        const form = useForm<ProductFormData>({
            defaultValues: {
                name: 'Wireless Headphones',
                slug: 'wireless-headphones',
                description: 'High-quality wireless headphones with active noise cancellation.',
                enabled: true,
            },
        });

        const onSubmit = (data: ProductFormData) => {
            console.log('Form submitted:', data);
            // In a real app, you would call your update mutation here
        };

        return (
            <RouterContextProvider router={router}>
                <Page
                    pageId="product-custom-detail"
                    form={form}
                    submitHandler={form.handleSubmit(onSubmit)}
                    entity={{
                        id: '1',
                        createdAt: '2024-01-01T00:00:00.000Z',
                        updatedAt: '2024-01-15T00:00:00.000Z',
                    }}
                >
                    <PageTitle>
                        <Trans>Product: Wireless Headphones</Trans>
                    </PageTitle>
                    <PageActionBar>
                        <PageActionBarRight>
                            <Button type="submit" disabled={!form.formState.isDirty}>
                                <Trans>Save Changes</Trans>
                            </Button>
                        </PageActionBarRight>
                    </PageActionBar>
                    <PageLayout>
                        <PageBlock
                            column="main"
                            blockId="product-details"
                            title={<Trans>Product Details</Trans>}
                            description={<Trans>Basic information about the product</Trans>}
                        >
                            <DetailFormGrid>
                                <FormFieldWrapper
                                    control={form.control}
                                    name="name"
                                    label={<Trans>Product Name</Trans>}
                                    description={<Trans>The display name of the product</Trans>}
                                    render={({ field }) => <Input {...field} />}
                                />
                                <FormFieldWrapper
                                    control={form.control}
                                    name="slug"
                                    label={<Trans>Slug</Trans>}
                                    description={<Trans>URL-friendly identifier</Trans>}
                                    render={({ field }) => <Input {...field} />}
                                />
                            </DetailFormGrid>
                            <FormFieldWrapper
                                control={form.control}
                                name="description"
                                label={<Trans>Description</Trans>}
                                render={({ field }) => <Textarea {...field} rows={4} />}
                            />
                        </PageBlock>
                        <PageBlock column="side" blockId="product-status" title={<Trans>Status</Trans>}>
                            <FormFieldWrapper
                                control={form.control}
                                name="enabled"
                                label={<Trans>Enabled</Trans>}
                                description={<Trans>Whether this product is active</Trans>}
                                render={({ field }) => (
                                    <div className="flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={field.value}
                                            onChange={field.onChange}
                                            className="mr-2"
                                        />
                                        <span className="text-sm">
                                            {field.value ? (
                                                <Trans>Product is enabled</Trans>
                                            ) : (
                                                <Trans>Product is disabled</Trans>
                                            )}
                                        </span>
                                    </div>
                                )}
                            />
                        </PageBlock>
                    </PageLayout>
                </Page>
            </RouterContextProvider>
        );
    },
};

/**
 * This example shows a more complex form with multiple blocks and varied form fields.
 */
export const ComplexCustomForm: Story = {
    render: () => {
        const { route, router } = createDemoRoute();
        const form = useForm({
            defaultValues: {
                // Basic Info
                name: 'Premium Laptop',
                slug: 'premium-laptop',
                sku: 'LAPTOP-001',
                // Pricing
                price: 1299.99,
                salePrice: null,
                costPrice: 899.0,
                // Inventory
                stockOnHand: 50,
                trackInventory: true,
                // Details
                description: 'High-performance laptop for professionals',
                shortDescription: 'Professional laptop',
                // SEO
                metaTitle: '',
                metaDescription: '',
            },
        });

        const onSubmit = (data: any) => {
            console.log('Form submitted:', data);
        };

        return (
            <RouterContextProvider router={router}>
                <Page
                    pageId="product-complex-detail"
                    form={form}
                    submitHandler={form.handleSubmit(onSubmit)}
                    entity={{ id: '2', createdAt: '2024-01-01', updatedAt: '2024-01-15' }}
                >
                    <PageTitle>
                        <Trans>Product: Premium Laptop</Trans>
                    </PageTitle>
                    <PageActionBar>
                        <PageActionBarRight>
                            <Button variant="outline" type="button">
                                <Trans>Cancel</Trans>
                            </Button>
                            <Button type="submit" disabled={!form.formState.isDirty}>
                                <Trans>Save Changes</Trans>
                            </Button>
                        </PageActionBarRight>
                    </PageActionBar>
                    <PageLayout>
                        <PageBlock
                            column="main"
                            blockId="basic-info"
                            title={<Trans>Basic Information</Trans>}
                        >
                            <DetailFormGrid>
                                <FormFieldWrapper
                                    control={form.control}
                                    name="name"
                                    label={<Trans>Product Name</Trans>}
                                    render={({ field }) => <Input {...field} />}
                                />
                                <FormFieldWrapper
                                    control={form.control}
                                    name="sku"
                                    label={<Trans>SKU</Trans>}
                                    render={({ field }) => <Input {...field} />}
                                />
                                <FormFieldWrapper
                                    control={form.control}
                                    name="slug"
                                    label={<Trans>Slug</Trans>}
                                    render={({ field }) => <Input {...field} />}
                                />
                            </DetailFormGrid>
                        </PageBlock>

                        <PageBlock column="main" blockId="description" title={<Trans>Description</Trans>}>
                            <FormFieldWrapper
                                control={form.control}
                                name="shortDescription"
                                label={<Trans>Short Description</Trans>}
                                render={({ field }) => <Input {...field} />}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="description"
                                label={<Trans>Full Description</Trans>}
                                render={({ field }) => <Textarea {...field} rows={6} />}
                            />
                        </PageBlock>

                        <PageBlock column="main" blockId="pricing" title={<Trans>Pricing</Trans>}>
                            <DetailFormGrid>
                                <FormFieldWrapper
                                    control={form.control}
                                    name="price"
                                    label={<Trans>Price</Trans>}
                                    render={({ field }) => <Input {...field} type="number" step="0.01" />}
                                />
                                <FormFieldWrapper
                                    control={form.control}
                                    name="salePrice"
                                    label={<Trans>Sale Price</Trans>}
                                    description={<Trans>Optional discounted price</Trans>}
                                    render={({ field }) => (
                                        <Input
                                            {...field}
                                            type="number"
                                            step="0.01"
                                            value={field.value ?? ''}
                                        />
                                    )}
                                />
                                <FormFieldWrapper
                                    control={form.control}
                                    name="costPrice"
                                    label={<Trans>Cost Price</Trans>}
                                    description={<Trans>Your cost for this product</Trans>}
                                    render={({ field }) => <Input {...field} type="number" step="0.01" />}
                                />
                            </DetailFormGrid>
                        </PageBlock>

                        <PageBlock column="side" blockId="inventory" title={<Trans>Inventory</Trans>}>
                            <div className="space-y-4">
                                <FormFieldWrapper
                                    control={form.control}
                                    name="trackInventory"
                                    label={<Trans>Track Inventory</Trans>}
                                    render={({ field }) => (
                                        <div className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={field.value}
                                                onChange={field.onChange}
                                                className="mr-2"
                                            />
                                        </div>
                                    )}
                                />
                                <FormFieldWrapper
                                    control={form.control}
                                    name="stockOnHand"
                                    label={<Trans>Stock on Hand</Trans>}
                                    render={({ field }) => <Input {...field} type="number" />}
                                />
                            </div>
                        </PageBlock>

                        <PageBlock column="side" blockId="seo" title={<Trans>SEO</Trans>}>
                            <div className="space-y-4">
                                <FormFieldWrapper
                                    control={form.control}
                                    name="metaTitle"
                                    label={<Trans>Meta Title</Trans>}
                                    render={({ field }) => <Input {...field} />}
                                />
                                <FormFieldWrapper
                                    control={form.control}
                                    name="metaDescription"
                                    label={<Trans>Meta Description</Trans>}
                                    render={({ field }) => <Textarea {...field} rows={3} />}
                                />
                            </div>
                        </PageBlock>
                    </PageLayout>
                </Page>
            </RouterContextProvider>
        );
    },
};
