import { text, isCancel } from '@clack/prompts';
import { PassThrough } from 'node:stream';
const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
const output = new PassThrough(); output.columns = 80;
setTimeout(() => input.write('\r'), 100);
const a = await text({ message: 'x', input, output });
console.log(JSON.stringify({ a, cancel: isCancel(a), str: String(a) }));
process.exit(0);
