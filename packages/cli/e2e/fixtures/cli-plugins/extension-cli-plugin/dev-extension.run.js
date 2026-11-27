// Runs `vendure dev` unchanged. A real extension would start its own processes here, and stop them
// in a `finally` once next() resolves.
export async function run(_input, _ctx, next) {
    return next();
}
