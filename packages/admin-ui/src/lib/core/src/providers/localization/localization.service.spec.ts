import { TestBed } from '@angular/core/testing';

import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestingCommonModule } from '../../../../../testing/testing-common.module';
import { MockI18nService } from '../i18n/i18n.service.mock';
import { DataService } from '../../data/providers/data.service';
import { I18nService } from '../../providers/i18n/i18n.service';
import { LocalizationService } from './localization.service';

describe('LocalizationService', () => {
    let service: LocalizationService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [TestingCommonModule],
            providers: [
                LocalizationService,
                { provide: I18nService, useClass: MockI18nService },
                { provide: DataService, useClass: class {} },
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA],
        });
        service = TestBed.inject(LocalizationService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });
});
