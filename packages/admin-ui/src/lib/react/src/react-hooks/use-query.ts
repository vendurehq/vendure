import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { DataService } from '@vendure/admin-ui/core';
import { DocumentNode } from 'graphql/index';
import { useCallback, useContext, useEffect, useState } from 'react';
import { firstValueFrom, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { HostedComponentContext } from '../directives/react-component-host.directive';

/**
 * @description
 * A React hook which provides access to the results of a GraphQL query.
 *
 * @example
 * ```ts
 * import { useQuery } from '\@vendure/admin-ui/react';
 * import { gql } from 'graphql-tag';
 *
 * const GET_PRODUCT = gql`
 *    query GetProduct($id: ID!) {
 *      product(id: $id) {
 *        id
 *        name
 *        description
 *      }
 *    }`;
 *
 * export const MyComponent = () => {
 *     const { data, loading, error } = useQuery(GET_PRODUCT, { id: '1' }, { refetchOnChannelChange: true });
 *
 *     if (loading) return <div>Loading...</div>;
 *     if (error) return <div>Error! { error }</div>;
 *     return (
 *         <div>
 *             <h1>{data.product.name}</h1>
 *             <p>{data.product.description}</p>
 *         </div>
 *     );
 * };
 * ```
 *
 * @docsCategory react-hooks
 */
export function useQuery<T, V extends Record<string, any> = Record<string, any>>(
    query: DocumentNode | TypedDocumentNode<T, V>,
    variables?: V,
    options: { refetchOnChannelChange: boolean } = { refetchOnChannelChange: false },
) {
    const { refetchOnChannelChange } = options;
    const { data, loading, error, runQuery } = useDataService<T, V>((dataService, vars) => {
        let queryFn = dataService.query(query, vars);
        if (refetchOnChannelChange) {
            queryFn = queryFn.refetchOnChannelChange();
        }
        return queryFn.stream$;
    });
    useEffect(() => {
        const subscription = runQuery(variables).subscribe();
        return () => subscription.unsubscribe();
    }, [runQuery]);

    const refetch = (variables?: V) => firstValueFrom(runQuery(variables));
    return { data, loading, error, refetch } as const;
}

/**
 * @description
 * A React hook which allows you to execute a GraphQL query lazily.
 *
 * @example
 * ```ts
 * import { useLazyQuery } from '\@vendure/admin-ui/react';
 * import { gql } from 'graphql-tag';
 *
 * const GET_PRODUCT = gql`
 *    query GetProduct($id: ID!) {
 *      product(id: $id) {
 *        id
 *        name
 *        description
 *      }
 *    }`;
 * type ProductResponse = {
 *     product: {
 *         name: string
 *         description: string
 *     }
 * }
 *
 * export const MyComponent = () => {
 *     const [getProduct, { data, loading, error }] = useLazyQuery<ProductResponse>(GET_PRODUCT, { refetchOnChannelChange: true });
 *
 *    const handleClick = () => {
 *         getProduct({
 *              id: '1',
 *         }).then(result => {
 *             // do something with the result
 *         });
 *     };
 *
 *     if (loading) return <div>Loading...</div>;
 *     if (error) return <div>Error! { error }</div>;
 *
 *     return (
 *     <div>
 *         <button onClick={handleClick}>Get product</button>
 *         {data && (
 *              <div>
 *                  <h1>{data.product.name}</h1>
 *                  <p>{data.product.description}</p>
 *              </div>)}
 *     </div>
 *     );
 * };
 * ```
 *
 * @since 2.2.0
 * @docsCategory react-hooks
 */
export function useLazyQuery<T, V extends Record<string, any> = Record<string, any>>(
    query: DocumentNode | TypedDocumentNode<T, V>,
    options: { refetchOnChannelChange: boolean } = { refetchOnChannelChange: false },
) {
    const { refetchOnChannelChange } = options;
    const { data, loading, error, runQuery } = useDataService<T, V>((dataService, vars) => {
        let queryFn = dataService.query(query, vars);
        if (refetchOnChannelChange) {
            queryFn = queryFn.refetchOnChannelChange();
        }
        return queryFn.stream$;
    });
    const rest = { data, loading, error };
    const execute = (variables?: V) => firstValueFrom(runQuery(variables));
    return [execute, rest] as [typeof execute, typeof rest];
}

/**
 * @description
 * A React hook which allows you to execute a GraphQL mutation.
 *
 * @example
 * ```ts
 * import { useMutation } from '\@vendure/admin-ui/react';
 * import { gql } from 'graphql-tag';
 *
 * const UPDATE_PRODUCT = gql`
 *   mutation UpdateProduct($input: UpdateProductInput!) {
 *     updateProduct(input: $input) {
 *     id
 *     name
 *   }
 * }`;
 *
 * export const MyComponent = () => {
 *     const [updateProduct, { data, loading, error }] = useMutation(UPDATE_PRODUCT);
 *
 *     const handleClick = () => {
 *         updateProduct({
 *             input: {
 *                 id: '1',
 *                 name: 'New name',
 *             },
 *         }).then(result => {
 *             // do something with the result
 *         });
 *     };
 *
 *     if (loading) return <div>Loading...</div>;
 *     if (error) return <div>Error! { error }</div>;
 *
 *     return (
 *     <div>
 *         <button onClick={handleClick}>Update product</button>
 *         {data && <div>Product updated!</div>}
 *     </div>
 *     );
 * };
 * ```
 *
 * @docsCategory react-hooks
 */
export function useMutation<T, V extends Record<string, any> = Record<string, any>>(
    mutation: DocumentNode | TypedDocumentNode<T, V>,
) {
    const { data, loading, error, runQuery } = useDataService<T, V>((dataService, variables) =>
        dataService.mutate(mutation, variables),
    );
    const rest = { data, loading, error };
    const execute = (variables?: V) => firstValueFrom(runQuery(variables));
    return [execute, rest] as [typeof execute, typeof rest];
}

export function useDataService<T, V extends Record<string, any> = Record<string, any>>(
    operation: (dataService: DataService, variables?: V) => Observable<T>,
) {
    const context = useContext(HostedComponentContext);
    const dataService = context?.injector.get(DataService);
    if (!dataService) {
        throw new Error('No DataService found in HostedComponentContext');
    }

    const [data, setData] = useState<T>();
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(false);

    const runQuery = useCallback((variables?: V) => {
        setLoading(true);
        return operation(dataService, variables).pipe(
            tap({
                next: res => {
                    setData(res);
                    setLoading(false);
                },
                error: err => {
                    setError(err.message);
                    setLoading(false);
                },
            }),
        );
    }, []);

    return { data, loading, error, runQuery };
}
