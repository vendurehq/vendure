/**
 * Normalizes a string to replace non-alphanumeric and diacritical marks with
 * plain equivalents.
 * Based on https://stackoverflow.com/a/37511463/772859
 */
export function normalizeString(input: string, spaceReplacer = ' '): string {
    const multipleSequentialReplacerRegex = new RegExp(`([${spaceReplacer}]){2,}`, 'g');

    return (input || '')
        .normalize('NFD')
        .replace(/[\u00df]/g, 'ss')
        .replace(/[\u1e9e]/g, 'SS')
        .replace(/[\u0308]/g, 'e')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[!"£$%^&*()+[\]{};:@#~?\\/,|><`¬'=‘’©®™]/g, '')
        .replace(/\s+/g, spaceReplacer)
        .replace(multipleSequentialReplacerRegex, spaceReplacer);
}
