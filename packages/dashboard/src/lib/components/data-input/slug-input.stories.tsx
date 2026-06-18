import type { Meta, StoryObj } from '@storybook/react-vite';
import { FormProvider, useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { SlugInput } from './slug-input.js';

const meta = {
    title: 'Form Inputs/SlugInput',
    component: SlugInput,
    ...withDescription(import.meta.url, './slug-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    decorators: [
        Story => (
            <div className="w-[500px]">
                <Story />
            </div>
        ),
    ],
    argTypes: {
        entityName: {
            control: 'text',
            description: 'The name of the entity (e.g., "Product", "Collection")',
        },
        fieldName: {
            control: 'text',
            description: 'The name of the field to check for uniqueness (e.g., "slug", "code")',
        },
        watchFieldName: {
            control: 'text',
            description: 'The name of the field to watch for changes',
        },
        defaultReadonly: {
            control: 'boolean',
            description: 'Whether the input should start in readonly mode',
        },
    },
} satisfies Meta<typeof SlugInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AutoGenerating: Story = {
    render: () => {
        const form = useForm({
            defaultValues: {
                name: 'Product Name',
                slug: '',
            },
        });

        return (
            <FormProvider {...form}>
                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium mb-2 block">Name</label>
                        <input
                            {...form.register('name')}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors"
                            placeholder="Enter product name"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium mb-2 block">Slug (auto-generated)</label>
                        <SlugInput
                            {...form.register('slug')}
                            value={form.watch('slug')}
                            onChange={value => form.setValue('slug', value)}
                            entityName="Product"
                            fieldName="slug"
                            watchFieldName="name"
                        />
                    </div>
                    <div className="text-sm text-muted-foreground">
                        <div>Name value: {form.watch('name')}</div>
                        <div>Slug value: {form.watch('slug')}</div>
                    </div>
                </div>
            </FormProvider>
        );
    },
};

export const WithExistingValue: Story = {
    render: () => {
        const form = useForm({
            defaultValues: {
                name: 'Existing Product',
                slug: 'existing-product-slug',
            },
        });

        return (
            <FormProvider {...form}>
                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium mb-2 block">Name</label>
                        <input
                            {...form.register('name')}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors"
                            placeholder="Enter product name"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium mb-2 block">Slug (with existing value)</label>
                        <SlugInput
                            {...form.register('slug')}
                            value={form.watch('slug')}
                            onChange={value => form.setValue('slug', value)}
                            entityName="Product"
                            fieldName="slug"
                            watchFieldName="name"
                            entityId="1"
                        />
                    </div>
                    <div className="text-sm text-muted-foreground">
                        Click the Edit button to manually edit the slug, or click Regenerate to update from
                        the name field.
                    </div>
                </div>
            </FormProvider>
        );
    },
};

export const ManualEditing: Story = {
    render: () => {
        const form = useForm({
            defaultValues: {
                name: 'Custom Product',
                slug: '',
            },
        });

        return (
            <FormProvider {...form}>
                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium mb-2 block">Name</label>
                        <input
                            {...form.register('name')}
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors"
                            placeholder="Enter product name"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium mb-2 block">
                            Slug (click Edit to customize)
                        </label>
                        <SlugInput
                            {...form.register('slug')}
                            value={form.watch('slug')}
                            onChange={value => form.setValue('slug', value)}
                            entityName="Product"
                            fieldName="slug"
                            watchFieldName="name"
                        />
                    </div>
                    <div className="text-sm text-muted-foreground">
                        Click the Edit button to switch to manual mode. Click the Lock button to switch back
                        to auto-generation.
                    </div>
                </div>
            </FormProvider>
        );
    },
};

export const StartInEditableMode: Story = {
    render: () => {
        const form = useForm({
            defaultValues: {
                code: '',
            },
        });

        return (
            <FormProvider {...form}>
                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium mb-2 block">Channel Code</label>
                        <SlugInput
                            {...form.register('code')}
                            value={form.watch('code')}
                            onChange={value => form.setValue('code', value)}
                            entityName="Channel"
                            fieldName="code"
                            watchFieldName="name"
                            defaultReadonly={false}
                        />
                    </div>
                    <div className="text-sm text-muted-foreground">
                        This slug input starts in editable mode (defaultReadonly=false).
                    </div>
                </div>
            </FormProvider>
        );
    },
};

export const Readonly: Story = {
    render: () => {
        const form = useForm({
            defaultValues: {
                slug: 'readonly-slug',
            },
        });

        return (
            <FormProvider {...form}>
                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium mb-2 block">Readonly Slug</label>
                        <SlugInput
                            {...form.register('slug')}
                            value={form.watch('slug')}
                            onChange={value => form.setValue('slug', value)}
                            entityName="Product"
                            fieldName="slug"
                            watchFieldName="name"
                            fieldDef={{ readonly: true }}
                        />
                    </div>
                    <div className="text-sm text-muted-foreground">
                        This slug input is readonly (fieldDef.readonly=true). No edit buttons are shown.
                    </div>
                </div>
            </FormProvider>
        );
    },
};
