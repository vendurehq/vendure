// eslint-disable-next-line @typescript-eslint/no-var-requires
const { customAlphabet } = require('nanoid');

const nanoid = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 16);

/**
 * Generates a random, human-readable string of numbers and upper-case letters
 * for use as public-facing identifiers for things like order or customers.
 *
 * The restriction to only uppercase letters and numbers is intended to make
 * reading and reciting the generated string easier and less error-prone for people.
 * Note that the letters "O" and "I" and number 0 are also omitted because they are easily
 * confused.
 *
 * There is a trade-off between the length of the string and the probability
 * of collisions (the same ID being generated twice). We are using a length of
 * 16, which according to calculations (https://zelark.github.io/nano-id-cc/)
 * would require IDs to be generated at a rate of 1000/hour for 23k years to
 * reach a probability of 1% that a collision would occur.
 */
export function generatePublicId(): string {
    return nanoid();
}
