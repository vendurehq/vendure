/**
 * @description
 * "Prorate" means "to divide, distribute, or calculate proportionately."
 *
 * This function is used to distribute the `total` into parts proportional
 * to the `distribution` array. This is required to split up an Order-level
 * discount between OrderLines, and then between OrderItems in the line.
 *
 * Based on https://stackoverflow.com/a/12844927/772859
 */
export function prorate(weights: number[], amount: number): number[] {
    const totalWeight = weights.reduce((total, val) => total + val, 0);
    const length = weights.length;

    const actual: number[] = [];
    const error: number[] = [];
    const rounded: number[] = [];

    let added = 0;

    let i = 0;
    for (const w of weights) {
        actual[i] = totalWeight === 0 ? amount / weights.length : amount * (w / totalWeight);
        rounded[i] = Math.floor(actual[i]);
        error[i] = actual[i] - rounded[i];
        added += rounded[i];
        i += 1;
    }

    while (added < amount) {
        let maxError = 0.0;
        let maxErrorIndex = -1;
        for (let e = 0; e < length; ++e) {
            if (error[e] > maxError) {
                maxError = error[e];
                maxErrorIndex = e;
            }
        }

        rounded[maxErrorIndex] += 1;
        error[maxErrorIndex] -= 1;

        added += 1;
    }

    return rounded;
}
