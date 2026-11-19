import { Settings } from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '../ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { GlobalViewsSheet } from './global-views-sheet.js';

export const ManageGlobalViewsButton: React.FC = () => {
    const [sheetOpen, setSheetOpen] = useState(false);
    const { t } = useLingui();

    return (
        <>
            <Tooltip>
                <TooltipTrigger render={<Button
                            variant="outline"
                            size="icon-sm"
                            onClick={() => setSheetOpen(true)}
                            aria-label={t`Manage global views`}
                        />}>
                        <Settings />
                </TooltipTrigger>
                <TooltipContent>
                    <Trans>Manage global views</Trans>
                </TooltipContent>
            </Tooltip>
            <GlobalViewsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
        </>
    );
};
