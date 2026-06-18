import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { withDescription } from '../../../.storybook/with-description.js';
import { RichTextInput } from './rich-text-input.js';

const meta = {
    title: 'Form Inputs/RichTextInput',
    component: RichTextInput,
    ...withDescription(import.meta.url, './rich-text-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'text',
            description: 'The rich text HTML content',
        },
    },
} satisfies Meta<typeof RichTextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: '<p>Edit this <strong>rich text</strong> content!</p>',
    },
    render: args => {
        const { register } = useForm();
        const field = register('content');
        return (
            <div className="w-[600px]">
                <RichTextInput {...field} {...args} />
            </div>
        );
    },
};

export const EmptyEditor: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('empty');
        return (
            <div className="w-[600px]">
                <RichTextInput {...field} />
            </div>
        );
    },
};

export const WithComplexContent: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('complex');
        return (
            <div className="w-[600px]">
                <RichTextInput
                    {...field}
                    value={`
                        <h2>Product Description</h2>
                        <p>This is a <strong>high-quality</strong> product with the following features:</p>
                        <ul>
                            <li>Feature one with <em>emphasis</em></li>
                            <li>Feature two with a <a href="https://example.com">link</a></li>
                            <li>Feature three</li>
                        </ul>
                        <blockquote>
                            <p>Customer testimonial goes here</p>
                        </blockquote>
                    `}
                />
            </div>
        );
    },
};

export const ReadonlyMode: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('readonly');
        return (
            <div className="w-[600px]">
                <RichTextInput
                    {...field}
                    value="<p>This content is <strong>readonly</strong> and cannot be edited.</p>"
                    fieldDef={{ readonly: true }}
                />
            </div>
        );
    },
};
