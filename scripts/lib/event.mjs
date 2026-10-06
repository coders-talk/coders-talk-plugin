/** The event an agent writes on a hook's stdin, parsed: a module of its own, for hooks that load nothing else. */
export async function readEvent(input = process.stdin) {
    let text = '';
    for await (const chunk of input) text += chunk;

    return JSON.parse(text);
}
