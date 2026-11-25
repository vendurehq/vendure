export async function run(input, ctx) {
    ctx.notice('info', `Greeting ${input.name}`);
    const message = `Hello, ${input.name}!`;
    return { message: input.shout ? message.toUpperCase() : message };
}
