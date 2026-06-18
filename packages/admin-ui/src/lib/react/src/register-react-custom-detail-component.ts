import { inject, provideAppInitializer } from '@angular/core';
import { CustomDetailComponentLocationId, CustomDetailComponentService } from '@vendure/admin-ui/core';
import { ElementType } from 'react';
import {
    REACT_CUSTOM_DETAIL_COMPONENT_OPTIONS,
    ReactCustomDetailComponent,
} from './components/react-custom-detail.component';

/**
 * @description
 * Configures a React-based component to be placed in a detail page in the given location.
 *
 * @docsCategory react-extensions
 */
export interface ReactCustomDetailComponentConfig {
    /**
     * @description
     * The id of the detail page location in which to place the component.
     */
    locationId: CustomDetailComponentLocationId;
    /**
     * @description
     * The React component to render.
     */
    component: ElementType;
    /**
     * @description
     * Optional props to pass to the React component.
     */
    props?: Record<string, any>;
}

/**
 * @description
 * Registers a React component to be rendered in a detail page in the given location.
 * Components used as custom detail components can make use of the {@link useDetailComponentData} hook.
 *
 * @docsCategory react-extensions
 */
export function registerReactCustomDetailComponent(config: ReactCustomDetailComponentConfig) {
    return provideAppInitializer(() => {
        const initializerFn = ((customDetailComponentService: CustomDetailComponentService) => () => {
            customDetailComponentService.registerCustomDetailComponent({
                component: ReactCustomDetailComponent,
                locationId: config.locationId,
                providers: [
                    {
                        provide: REACT_CUSTOM_DETAIL_COMPONENT_OPTIONS,
                        useValue: {
                            component: config.component,
                            props: config.props,
                        },
                    },
                ],
            });
        })(inject(CustomDetailComponentService));
        return initializerFn();
      });
}
