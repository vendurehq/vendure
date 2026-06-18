import { Injector } from '@angular/core';
import { FormControl } from '@angular/forms';
import { CustomField, PageMetadataService } from '@vendure/admin-ui/core';

export interface ReactFormInputOptions {
    formControl: FormControl;
    readonly: boolean;
    config: CustomField & Record<string, any>;
}

export interface ReactFormInputProps extends ReactFormInputOptions {}

export interface ReactRouteComponentOptions {
    props?: Record<string, any>;
}

export type HostedReactComponentContext<T extends Record<string, any> = Record<string, any>> = {
    injector: Injector;
    pageMetadataService?: PageMetadataService;
} & T;
