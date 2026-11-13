import { Injectable } from '@nestjs/common';
import os from 'node:os';

import { TelemetryRuntime } from '../telemetry.types';

export interface SystemInfo {
    nodeVersion: string;
    platform: string;
    runtime: TelemetryRuntime;
}

/**
 * Collects basic system and runtime information for telemetry.
 * Each runtime sub-field is resolved independently so that a single
 * failure never prevents the others from being reported.
 */
@Injectable()
export class SystemInfoCollector {
    collect(): SystemInfo {
        return {
            nodeVersion: process.version,
            platform: `${os.platform()} ${os.arch()}`,
            runtime: this.collectRuntime(),
        };
    }

    private collectRuntime(): TelemetryRuntime {
        return {
            runtimeType: this.getRuntimeType(),
            packageManager: this.getPackageManager(),
            tsNode: this.getTsNode(),
            cpuCount: this.getCpuCount(),
            totalMemoryGb: this.getTotalMemoryGb(),
        };
    }

    private getRuntimeType(): TelemetryRuntime['runtimeType'] {
        try {
            if ((process.versions as Record<string, string>).bun) {
                return 'bun';
            }
            if ((process.versions as Record<string, string>).deno) {
                return 'deno';
            }
            return 'node';
        } catch {
            return undefined;
        }
    }

    private getPackageManager(): TelemetryRuntime['packageManager'] {
        try {
            // Mirrors the parsing in packages/create/src/helpers.ts
            const name = process.env.npm_config_user_agent?.split(' ')[0]?.split('/')[0];
            if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') {
                return name;
            }
            return 'unknown';
        } catch {
            return undefined;
        }
    }

    private getTsNode(): boolean | undefined {
        try {
            return !!(process as any)[Symbol.for('ts-node.register.instance')];
        } catch {
            return undefined;
        }
    }

    private getCpuCount(): number | undefined {
        try {
            const count = os.cpus().length;
            return count > 0 ? count : undefined;
        } catch {
            return undefined;
        }
    }

    private getTotalMemoryGb(): number | undefined {
        try {
            return Math.round(os.totalmem() / 2 ** 30);
        } catch {
            return undefined;
        }
    }
}
