import path from 'node:path';

// The preview names the file, so a consent given for one project never deletes another's data.
export async function plan(_input, ctx) {
    return {
        preview: { action: 'Delete the example data', file: path.join(ctx.cwd, 'example-data.json') },
        requiredConsents: ['resetData'],
    };
}
