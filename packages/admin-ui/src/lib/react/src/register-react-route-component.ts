import { Route } from '@angular/router';
import { ResultOf, TypedDocumentNode } from '@graphql-typed-document-node/core';
import { registerRouteComponent, RegisterRouteComponentOptions } from '@vendure/admin-ui/core';
import { DocumentNode } from 'graphql/index';
import { ElementType } from 'react';
import { REACT_ROUTE_COMPONENT_OPTIONS, ReactRouteComponent } from './components/react-route.component';
import { ReactRouteComponentOptions } from './types';

/**
 * @description
 * Configuration for a React-based route component.
 *
 * @docsCategory react-extensions
 */
type RegisterReactRouteComponentOptions<
    Entity extends { id: string; updatedAt?: string },
    T extends DocumentNode | TypedDocumentNode<any, { id: string }>,
    Field extends keyof ResultOf<T>,
    R extends Field,
> = RegisterRouteComponentOptions<ElementType, Entity, T, Field, R> & {
    props?: Record<string, any>;
};

/**
 * @description
 * Registers a React component to be used as a route component.
 *
 * @docsCategory react-extensions
 */
export function registerReactRouteComponent<
    Entity extends { id: string; updatedAt?: string },
    T extends DocumentNode | TypedDocumentNode<any, { id: string }>,
    Field extends keyof ResultOf<T>,
    R extends Field,
>(options: RegisterReactRouteComponentOptions<Entity, T, Field, R>): Route {
    const routeDef = registerRouteComponent(options);
    return {
        ...routeDef,
        providers: [
            {
                provide: REACT_ROUTE_COMPONENT_OPTIONS,
                useValue: {
                    props: options.props,
                } satisfies ReactRouteComponentOptions,
            },
            ...(routeDef.providers ?? []),
        ],
        component: ReactRouteComponent,
    };
}
