import { inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { getAppConfig } from '../app.config';
import { I18nService } from '../providers/i18n/i18n.service';

/**
 * Creates a function that can be used to set the meta title of the current page.
 */
export function titleSetter() {
    const titleService = inject(Title);
    const i18nService = inject(I18nService);
    const brand = getAppConfig().brand || 'Vendure';
    return (title: string) => titleService.setTitle(`${i18nService.translate(title)} • ${brand}`);
}
