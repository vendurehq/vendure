import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import { Trans } from '@lingui/react/macro';
import { AlertCircle } from 'lucide-react';
import { FieldErrors, UseFormReturn, useFormState } from 'react-hook-form';

interface FlatError {
    name: string;
    // Undefined when the error has no message. A generic translated message is shown instead,
    // so the summary is never empty while the form is invalid.
    message?: string;
}

/**
 * Walks the nested react-hook-form errors object and collects the leaf errors,
 * flattening nested groups like `customFields` and arrays like
 * `stockLevels.0.stockOnHand` into dotted paths. A leaf is identified by an RHF
 * error `type`, so errors without a `message` are still listed. The reserved
 * `root` bucket (used for server/form-level errors) is skipped as it is not a
 * user-editable field.
 */
function collectErrors(errors: FieldErrors, path: string[] = []): FlatError[] {
    const result: FlatError[] = [];
    for (const [key, value] of Object.entries(errors ?? {})) {
        if (!value || key === 'root') {
            continue;
        }
        const currentPath = [...path, key];
        const message = (value as { message?: unknown }).message;
        const type = (value as { type?: unknown }).type;
        if (typeof message === 'string' && message.length > 0) {
            result.push({ name: currentPath.join('.'), message });
        } else if (typeof type === 'string') {
            result.push({ name: currentPath.join('.') });
        } else if (typeof value === 'object') {
            result.push(...collectErrors(value as FieldErrors, currentPath));
        }
    }
    return result;
}

function humanizeSegment(segment: string): string {
    const spaced = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Turns a dotted error path into a readable label, e.g. "customFields.myField" -> "My Field",
 * "stockLevels.0.stockOnHand" -> "Stock Levels › #1 › Stock On Hand", and
 * "translations.1.name" -> "Name (de)", using the row's language code.
 *
 * The label is derived from the path, so it is not translated and does not use the
 * configured custom field label.
 */
function humanizeFieldName(name: string, values: Record<string, any> | undefined): string {
    const translation = /^translations\.(\d+)\.(.+)$/.exec(name);
    if (translation) {
        const languageCode = values?.translations?.[Number(translation[1])]?.languageCode;
        const label = humanizeFieldName(translation[2], undefined);
        return languageCode ? `${label} (${languageCode})` : label;
    }
    return (
        name
            .split('.')
            // The "customFields" wrapper segment is noise on every custom field.
            .filter(segment => segment !== 'customFields')
            // Array indices become 1-based to disambiguate repeated groups.
            .map(segment => (/^\d+$/.test(segment) ? `#${Number(segment) + 1}` : humanizeSegment(segment)))
            .join(' › ')
    );
}

/**
 * @description
 * Lists the fields which stop a detail-page form from being submitted, with each
 * field's validation message. Rendered by the page layout for every page with a form,
 * because the submit button is disabled while the form is invalid and the offending
 * field may be out of view.
 */
export function FormErrorSummary({ form }: Readonly<{ form: UseFormReturn<any> }>) {
    const { errors } = useFormState({ control: form.control });
    const flatErrors = collectErrors(errors);
    if (flatErrors.length === 0) {
        return null;
    }
    return (
        <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>
                <Trans>This cannot be saved until the following are fixed:</Trans>
            </AlertTitle>
            <AlertDescription>
                <ul className="list-disc pl-4">
                    {flatErrors.map(error => (
                        <li key={error.name}>
                            {/* Focusing the field scrolls it into view. */}
                            <button
                                type="button"
                                className="font-medium underline underline-offset-2 hover:no-underline"
                                onClick={() => form.setFocus(error.name)}
                            >
                                {humanizeFieldName(error.name, form.getValues())}
                            </button>
                            : {error.message ?? <Trans>This field is invalid</Trans>}
                        </li>
                    ))}
                </ul>
            </AlertDescription>
        </Alert>
    );
}
