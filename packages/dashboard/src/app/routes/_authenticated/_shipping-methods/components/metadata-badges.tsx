import { Badge } from '@/vdb/components/ui/badge.js';
import React from 'react';

export function MetadataBadges({ metadata }: Readonly<{ metadata?: Record<string, any> }>) {
    if (!metadata || Object.keys(metadata).length === 0) return null;
    return (
        <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(metadata).map(([key, value]) => (
                <Badge key={key} variant="outline" className="text-xs">
                    {key}: {String(value)}
                </Badge>
            ))}
        </div>
    );
}
