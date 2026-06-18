import { Injectable, Provider, Type } from '@angular/core';

import { FormInputComponent } from '../../common/component-registry-types';

@Injectable({
    providedIn: 'root',
})
export class ComponentRegistryService {
    private inputComponentMap = new Map<
        string,
        { type: Type<FormInputComponent<any>>; providers: Provider[] }
    >();

    registerInputComponent(id: string, component: Type<FormInputComponent<any>>, providers?: Provider[]) {
        if (this.inputComponentMap.has(id)) {
            throw new Error(
                `Cannot register an InputComponent with the id "${id}", as one with that id already exists`,
            );
        }
        this.inputComponentMap.set(id, { type: component, providers: providers || [] });
    }

    getInputComponent(
        id: string,
    ): { type: Type<FormInputComponent<any>>; providers: Provider[] } | undefined {
        return this.inputComponentMap.get(id);
    }
}
