import {
    DashboardBaseWidget,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    useWidgetConfig,
} from '@vendure/dashboard';
import { Trans, useLingui } from '@lingui/react/macro';

export const STICKY_NOTE_WIDGET_ID = 'insights-test-sticky-note';

type NoteTone = 'neutral' | 'highlight' | 'accent' | 'secondary';

interface StickyNoteConfig extends Record<string, unknown> {
    tone: NoteTone;
}

export const STICKY_NOTE_DEFAULT_CONFIG: StickyNoteConfig = {
    tone: 'neutral',
};

const TONE_VALUES: NoteTone[] = ['neutral', 'highlight', 'accent', 'secondary'];

const TONE_CLASSES: Record<NoteTone, string> = {
    neutral: 'bg-muted text-foreground border-border',
    highlight: 'bg-primary/10 text-primary border-primary/30',
    accent: 'bg-accent text-accent-foreground border-border',
    secondary: 'bg-secondary text-secondary-foreground border-border',
};

// A multi-instance widget: each instance keeps its own independent `useWidgetConfig` state.
export function StickyNoteWidget() {
    const { t } = useLingui();
    const [config, setConfig] = useWidgetConfig<StickyNoteConfig>();
    const toneLabels: Record<NoteTone, string> = {
        neutral: t`Neutral`,
        highlight: t`Highlight`,
        accent: t`Accent`,
        secondary: t`Secondary`,
    };
    const items = Object.fromEntries(TONE_VALUES.map(tone => [tone, toneLabels[tone]]));

    return (
        <DashboardBaseWidget
            id={STICKY_NOTE_WIDGET_ID}
            title={t`Sticky Note`}
            description={t`Add several — each instance keeps its own tone`}
            actions={
                <Select
                    value={config.tone}
                    onValueChange={value => setConfig({ tone: value as NoteTone })}
                    items={items}
                >
                    <SelectTrigger className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {TONE_VALUES.map(tone => (
                            <SelectItem key={tone} value={tone}>
                                {toneLabels[tone]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            }
        >
            <div
                className={`flex h-full flex-col items-center justify-center rounded-md border ${TONE_CLASSES[config.tone]}`}
            >
                <div className="text-lg font-semibold">{toneLabels[config.tone]}</div>
                <div className="text-sm opacity-80">
                    <Trans>This instance's tone is stored in its config</Trans>
                </div>
            </div>
        </DashboardBaseWidget>
    );
}
