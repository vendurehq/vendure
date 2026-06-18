import { NotificationService } from '@vendure/admin-ui/core';
import { Link, useInjector, useMutation, useQuery } from '@vendure/admin-ui/react';
import gql from 'graphql-tag';
import React from 'react';

const GET_PRODUCTS = gql`
    query GetProducts($skip: Int, $take: Int) {
        products(options: { skip: $skip, take: $take }) {
            items {
                id
                name
                enabled
            }
            totalItems
        }
    }
`;

const TOGGLE_ENABLED = gql`
    mutation ToggleEnabled($id: ID!, $enabled: Boolean!) {
        updateProduct(input: { id: $id, enabled: $enabled }) {
            id
            enabled
        }
    }
`;

export function ProductList() {
    const { data, loading, error } = useQuery(GET_PRODUCTS, { skip: 0, take: 10 });
    const [toggleEnabled] = useMutation(TOGGLE_ENABLED);
    const notificationService = useInjector(NotificationService);

    function onToggle(id: string, enabled: boolean) {
        toggleEnabled({ id, enabled }).then(
            () => notificationService.success('Updated Product'),
            reason => notificationService.error(`Couldnt update product: ${reason as string}`),
        );
    }

    if (loading || !data)
        return (
            <div className="page-block">
                <h3>Loading...</h3>
            </div>
        );
    if (error)
        return (
            <div className="page-block">
                <h3>Error: {error}</h3>
            </div>
        );
    const products = (data as any).products;
    return products.items.length ? (
        <div className="page-block">
            <h3>
                Found {products.totalItems} products, showing {products.items.length}:
            </h3>
            <table className="table">
                <thead>
                    <tr>
                        <th>Toggle</th>
                        <th>State</th>
                        <th>Product</th>
                    </tr>
                </thead>
                <tbody>
                    {products.items.map((p: any, i: any) => (
                        <tr key={i}>
                            <td>
                                <button className="button-ghost" onClick={() => onToggle(p.id, !p.enabled)}>
                                    Toggle
                                </button>
                            </td>
                            <td>
                                {p.enabled ? (
                                    <span className="label label-success">Enabled</span>
                                ) : (
                                    <span className="label label-danger">Disabled</span>
                                )}
                            </td>
                            <td>
                                <Link href={`catalog/inventory/${p.id}`} className="button-ghost">
                                    {p.name}
                                </Link>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    ) : (
        <h3>Coudldn't find products.</h3>
    );
}
