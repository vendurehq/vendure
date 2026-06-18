import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { PageActionBarRight } from '@/vdb/framework/layout-engine/page-layout.js';
import { ListPage, ListPageProps } from '@/vdb/framework/page/list-page.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import type { Meta, StoryObj } from '@storybook/react';
import { PlusIcon } from 'lucide-react';
import { expect } from 'storybook/test';

import { DemoRouterProvider } from '../../../../.storybook/providers.js';

// Sample GraphQL query for countries
const countryItemFragment = graphql(`
    fragment CountryItem on Country {
        id
        createdAt
        updatedAt
        name
        code
        enabled
    }
`);

const countriesListQuery = graphql(
    `
        query CountriesList($options: CountryListOptions) {
            countries(options: $options) {
                items {
                    ...CountryItem
                }
                totalItems
            }
        }
    `,
    [countryItemFragment],
);

const deleteCountryDocument = graphql(`
    mutation DeleteCountry($id: ID!) {
        deleteCountry(id: $id) {
            result
            message
        }
    }
`);

function ListPageStoryWrapper(props: Omit<ListPageProps<any, any, any, any>, 'route'>) {
    return <DemoRouterProvider component={route => <ListPage {...props} route={() => route} />} />;
}

const meta = {
    title: 'Layout/ListPage',
    component: ListPageStoryWrapper,
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
    argTypes: {
        pageId: {
            control: 'text',
            description: 'Unique identifier for the list page',
        },
        title: {
            control: 'text',
            description: 'Page title displayed in the header',
        },
        listQuery: {
            control: false,
            description: 'GraphQL query document for fetching list data',
        },
        deleteMutation: {
            control: false,
            description: 'GraphQL mutation document for deleting items',
        },
        customizeColumns: {
            control: 'object',
            description:
                'Customize column rendering and behavior. Use `meta.disabled: true` to exclude columns from the table.',
        },
        defaultVisibility: {
            control: 'object',
            description: 'Default visible columns',
        },
    },
} satisfies Meta<typeof ListPageStoryWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Basic example of a ListPage showing countries from the demo API.
 * This demonstrates the minimal configuration needed to render a list.
 */
export const BasicList: Story = {
    args: {
        pageId: 'country-list',
        listQuery: countriesListQuery,
        title: 'Countries',
        defaultVisibility: {
            name: true,
            code: true,
            enabled: true,
        },
        customizeColumns: {
            updatedAt: {
                meta: { disabled: true },
            },
        },
    },
};

/**
 * ListPage with custom column rendering and delete mutation.
 * Shows how to customize the name column to render as a detail page button.
 */
export const WithCustomColumns: Story = {
    args: {
        pageId: 'country-list-custom',
        listQuery: countriesListQuery,
        deleteMutation: deleteCountryDocument,
        title: 'Countries',
        defaultVisibility: {
            name: true,
            code: true,
            enabled: true,
        },
        customizeColumns: {
            name: {
                cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
            },
        },
    },
};

/**
 * ListPage with search functionality.
 * Demonstrates how to configure search to filter on multiple fields.
 */
export const WithSearch: Story = {
    args: {
        pageId: 'country-list-search',
        listQuery: countriesListQuery,
        title: 'Countries',
        defaultVisibility: {
            name: true,
            code: true,
            enabled: true,
        },
        onSearchTermChange: (searchTerm: string) => {
            return {
                name: {
                    contains: searchTerm,
                },
                code: {
                    contains: searchTerm,
                },
            };
        },
        transformVariables: (variables: any) => {
            return {
                ...variables,
                options: {
                    ...variables.options,
                    filterOperator: 'OR',
                },
            };
        },
        customizeColumns: {
            name: {
                cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
            },
        },
    },
};

/**
 * ListPage with disabled columns.
 * Shows how to use `meta.disabled` to completely exclude columns from the table
 * and the column visibility toggle. The disabled columns' data can still be
 * accessed in other column renderers.
 */
export const WithDisabledColumns: Story = {
    args: {
        pageId: 'country-list-disabled',
        listQuery: countriesListQuery,
        title: 'Countries',
        defaultVisibility: {
            name: true,
            code: true,
            enabled: true,
        },
        customizeColumns: {
            name: {
                cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
            },
            // The createdAt and updatedAt columns are disabled and won't appear
            // in the table or in the column visibility toggle
            updatedAt: {
                meta: { disabled: true },
            },
            createdAt: {
                meta: { disabled: true },
            },
        },
    },
};

/**
 * Complete example with action bar and all features.
 * Shows the full ListPage configuration including custom action buttons.
 */
export const Complete: Story = {
    args: {
        pageId: 'country-list-complete',
        listQuery: countriesListQuery,
        deleteMutation: deleteCountryDocument,
        title: 'Countries',
        defaultVisibility: {
            name: true,
            code: true,
            enabled: true,
        },
        onSearchTermChange: (searchTerm: string) => {
            return {
                name: {
                    contains: searchTerm,
                },
                code: {
                    contains: searchTerm,
                },
            };
        },
        transformVariables: (variables: any) => {
            return {
                ...variables,
                options: {
                    ...variables.options,
                    filterOperator: 'OR',
                },
            };
        },
        customizeColumns: {
            name: {
                cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
            },
        },
        children: (
            <PageActionBarRight>
                <Button>
                    <PlusIcon />
                    Add Country
                </Button>
            </PageActionBarRight>
        ),
    },
};
