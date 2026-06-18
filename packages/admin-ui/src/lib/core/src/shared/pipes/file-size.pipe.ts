import { Pipe, PipeTransform } from '@angular/core';

/**
 * @description
 * Formats a number into a human-readable file size string.
 *
 * @example
 * ```ts
 * {{ fileSizeInBytes | filesize }}
 * ```
 *
 * @docsCategory pipes
 */
@Pipe({
    name: 'filesize',
    standalone: false,
})
export class FileSizePipe implements PipeTransform {
    transform(value: number, useSiUnits = true): any {
        if (typeof value !== 'number' && typeof value !== 'string') {
            return value;
        }
        return humanFileSize(value, useSiUnits === true);
    }
}

/**
 * Convert a number into a human-readable file size string.
 * Adapted from http://stackoverflow.com/a/14919494/772859
 */
function humanFileSize(bytes: number, si: boolean): string {
    const thresh = si ? 1000 : 1024;
    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }
    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while (Math.abs(bytes) >= thresh && u < units.length - 1);

    return bytes.toFixed(1) + ' ' + units[u];
}
