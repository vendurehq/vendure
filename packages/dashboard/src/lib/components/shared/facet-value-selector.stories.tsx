import type { Meta, StoryObj } from '@storybook/react-vite';
import { withDescription } from '../../../../.storybook/with-description.js';
import { FacetValueSelector } from './facet-value-selector.js';

const meta = {
    title: 'Framework/FacetValueSelector',
    component: FacetValueSelector,
    ...withDescription(import.meta.url, './facet-value-selector.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        disabled: {
            control: 'boolean',
            description: 'Whether the selector is disabled',
        },
        placeholder: {
            control: 'text',
            description: 'Placeholder text for the search input',
        },
        pageSize: {
            control: 'number',
            description: 'Number of facet values to display per page',
        },
    },
} satisfies Meta<typeof FacetValueSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        disabled: false,
        placeholder: 'Search facet values...',
        pageSize: 10,
    },
    render: args => {
        return (
            <FacetValueSelector
                {...args}
                onValueSelect={value => {
                    console.log('Selected facet value:', value);
                }}
            />
        );
    },
};
