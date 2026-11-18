import type { Locale } from 'date-fns/locale';

type LocaleLoader = () => Promise<Locale>;

// One lazy import per dashboard language, so that only the active language's locale is
// loaded. `react-day-picker/locale` re-exports every date-fns locale (and the Persian
// calendar), which bundles them all into a single 1.6 MB chunk. The per-language files
// add DayPicker's translated labels to the date-fns locale.
// English is DayPicker's built-in default, and date-fns has no Nepali locale.
const loaders: Record<string, LocaleLoader> = {
    ar: () => import('react-day-picker/locale/ar').then(m => m.ar),
    bg: () => import('react-day-picker/locale/bg').then(m => m.bg),
    cs: () => import('react-day-picker/locale/cs').then(m => m.cs),
    de: () => import('react-day-picker/locale/de').then(m => m.de),
    es: () => import('react-day-picker/locale/es').then(m => m.es),
    fa: () => import('react-day-picker/locale/fa-IR').then(m => m.faIR),
    fr: () => import('react-day-picker/locale/fr').then(m => m.fr),
    he: () => import('react-day-picker/locale/he').then(m => m.he),
    hr: () => import('react-day-picker/locale/hr').then(m => m.hr),
    hu: () => import('react-day-picker/locale/hu').then(m => m.hu),
    it: () => import('react-day-picker/locale/it').then(m => m.it),
    ja: () => import('react-day-picker/locale/ja').then(m => m.ja),
    ko: () => import('react-day-picker/locale/ko').then(m => m.ko),
    nb: () => import('react-day-picker/locale/nb').then(m => m.nb),
    nl: () => import('react-day-picker/locale/nl').then(m => m.nl),
    pl: () => import('react-day-picker/locale/pl').then(m => m.pl),
    pt: () => import('react-day-picker/locale/pt').then(m => m.pt),
    'pt-br': () => import('react-day-picker/locale/pt-BR').then(m => m.ptBR),
    ro: () => import('react-day-picker/locale/ro').then(m => m.ro),
    ru: () => import('react-day-picker/locale/ru').then(m => m.ru),
    sv: () => import('react-day-picker/locale/sv').then(m => m.sv),
    tr: () => import('react-day-picker/locale/tr').then(m => m.tr),
    uk: () => import('react-day-picker/locale/uk').then(m => m.uk),
    uz: () => import('react-day-picker/locale/uz').then(m => m.uz),
    zh: () => import('react-day-picker/locale/zh-CN').then(m => m.zhCN),
    'zh-hans': () => import('react-day-picker/locale/zh-CN').then(m => m.zhCN),
    'zh-hant': () => import('react-day-picker/locale/zh-TW').then(m => m.zhTW),
};

/**
 * Returns the loader of the DayPicker locale for a BCP 47 tag such as `de-DE`, `pt-BR` or
 * `zh-Hant-TW`, or `undefined` when DayPicker's default (US English) applies. The most
 * specific match wins: language-script or language-region first, then the language alone.
 */
export function getDayPickerLocaleLoader(tag: string): LocaleLoader | undefined {
    const parts = tag.replaceAll('_', '-').toLowerCase().split('-');
    for (let length = Math.min(parts.length, 2); length > 0; length--) {
        const loader = loaders[parts.slice(0, length).join('-')];
        if (loader) {
            return loader;
        }
    }
    return undefined;
}
