/**
 * For a given string, returns one of a pre-defined selection of colours.
 */
export function stringToColor(input: string): string {
    if (!input || input === '') {
        return '';
    }
    const safeColors = [
        '#10893E',
        '#107C10',
        '#7E735F',
        '#2F5646',
        '#498205',
        '#847545',
        '#744DA9',
        '#018574',
        '#486860',
        '#525E54',
        '#647C64',
        '#567C73',
        '#8764B8',
        '#515C6B',
        '#4A5459',
        '#69797E',
        '#0063B1',
        '#0078D7',
        '#2D7D9A',
        '#7A7574',
        '#767676',
    ];
    const value = input
        .split('')
        .reduce((prev, curr, index) => prev + Math.round(curr.charCodeAt(0) * Math.log(index + 2)), 0);
    return safeColors[value % safeColors.length];
}
