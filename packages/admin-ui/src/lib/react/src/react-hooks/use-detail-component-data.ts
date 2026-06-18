import { useContext, useEffect, useState } from 'react';
import { ReactCustomDetailComponentContext } from '../components/react-custom-detail.component';
import { HostedComponentContext } from '../directives/react-component-host.directive';
import { HostedReactComponentContext } from '../types';

/**
 * @description
 * Provides the data available to React-based CustomDetailComponents.
 *
 * @example
 * ```ts
 * import { Card, useDetailComponentData } from '\@vendure/admin-ui/react';
 * import React from 'react';
 *
 * export function CustomDetailComponent(props: any) {
 *     const { entity, detailForm } = useDetailComponentData();
 *     const updateName = () => {
 *         detailForm.get('name')?.setValue('New name');
 *         detailForm.markAsDirty();
 *     };
 *     return (
 *         <Card title={'Custom Detail Component'}>
 *             <button className="button" onClick={updateName}>
 *                 Update name
 *             </button>
 *             <pre>{JSON.stringify(entity, null, 2)}</pre>
 *         </Card>
 *     );
 * }
 * ```
 *
 * @docsCategory react-hooks
 */
export function useDetailComponentData<T = any>() {
    const context = useContext(
        HostedComponentContext,
    ) as HostedReactComponentContext<ReactCustomDetailComponentContext>;

    if (!context.detailForm || !context.entity$) {
        throw new Error(`The useDetailComponentData hook can only be used within a CustomDetailComponent`);
    }

    const [entity, setEntity] = useState<T | null>(null);

    useEffect(() => {
        const subscription = context.entity$.subscribe(value => {
            setEntity(value);
        });
        return () => subscription.unsubscribe();
    }, []);

    return {
        entity,
        detailForm: context.detailForm,
    };
}
