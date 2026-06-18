import { TestBed } from '@angular/core/testing';

import { ComponentRegistryService } from './component-registry.service';

describe('ComponentRegistryService', () => {
    let service: ComponentRegistryService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(ComponentRegistryService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });
});
