// The plugin coders-talk enable lays out (plan, stage 13.3): the repository's skills and hooks, calling the file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cmdCommand, MARKETPLACE, pluginFiles, pluginSources, psCommand, shCommand } from '../scripts/lib/plugin.mjs';

const sources = pluginSources();
const lay = (windows, program, mcp) => pluginFiles(sources, { program, version: '9.1.0', site: 'https://coders.talk', windows, mcp });
const WIN = ["C:\\Users\\Mara O'Neil\\.coders-talk\\bin\\coders-talk.exe"];
const POSIX = ['/home/mara/.coders-talk/bin/coders-talk'];

test('every skill and manifest of the repository is there, in the file\'s version, from the local marketplace', () => {
    const files = lay(false, POSIX);
    for (const path of Object.keys(sources).filter((p) => p.includes('skills/'))) assert.ok(files[path], path);
    assert.equal(JSON.parse(files['.claude-plugin/plugin.json']).version, '9.1.0');
    assert.equal(JSON.parse(files['.codex-plugin/plugin.json']).version, '9.1.0');
    assert.equal(JSON.parse(files['.claude-plugin/marketplace.json']).name, MARKETPLACE);
    assert.equal(JSON.parse(files['.agents/plugins/marketplace.json']).name, MARKETPLACE);
    assert.equal(JSON.parse(files['.claude-plugin/plugin.json']).userConfig.url.default, 'https://coders.talk');
    for (const [path, text] of Object.entries(files)) {
        assert.doesNotMatch(text, /coders-talk\.mjs|<plugin>|CLAUDE_PLUGIN_ROOT|\bnode "/, path);
    }
    // Node and the script, when enable runs from the repository.
    for (const text of Object.values(lay(false, ['/usr/bin/node', '/src/scripts/coders-talk.mjs']))) {
        assert.doesNotMatch(text, /<plugin>|CLAUDE_PLUGIN_ROOT|\bnode "/);
    }
});

test('Claude Code hooks run the file without a shell, one command per event', () => {
    const hooks = JSON.parse(lay(true, WIN)['hooks/hooks.json']).hooks;
    assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']);
    assert.deepEqual(hooks.Stop[0].hooks, [{ type: 'command', command: WIN[0], args: ['hook', 'claude-code', 'stop'], timeout: 10 }]);
    // Node and the script, when enable runs from the repository.
    const dev = JSON.parse(lay(false, ['/usr/bin/node', '/src/scripts/coders-talk.mjs'])['hooks/hooks.json']).hooks;
    assert.deepEqual(dev.SessionStart[0].hooks[0].args, ['/src/scripts/coders-talk.mjs', 'hook', 'claude-code', 'session-start']);
});

test('Codex gets PowerShell on Windows and sh elsewhere; the MCP helper gets cmd.exe on Windows', () => {
    const win = lay(true, WIN);
    assert.equal(JSON.parse(win['codex/hooks.json']).hooks.Stop[0].hooks[0].command, "& 'C:\\Users\\Mara O''Neil\\.coders-talk\\bin\\coders-talk.exe' hook codex stop");
    assert.equal(JSON.parse(win['codex/hooks.json']).hooks.SessionEnd[0].hooks[0].timeout, 3);
    assert.equal(JSON.parse(win['.mcp.json']).mcpServers['coders-talk'].headersHelper, `"${WIN[0]}" mcp-headers`);
    assert.match(win['codex/skills/build/SKILL.md'], /& 'C:\\Users\\Mara O''Neil\\\.coders-talk\\bin\\coders-talk\.exe' preview --agent=codex/);
    assert.match(win['skills/build/SKILL.md'], /In PowerShell, put `& ` in front/);
    assert.doesNotMatch(win['skills/lookup/SKILL.md'], /In PowerShell/, 'a skill without commands needs no word on it');

    const posix = lay(false, POSIX);
    assert.equal(JSON.parse(posix['codex/hooks.json']).hooks.Stop[0].hooks[0].command, "'/home/mara/.coders-talk/bin/coders-talk' hook codex stop");
    assert.equal(JSON.parse(posix['.mcp.json']).mcpServers['coders-talk'].headersHelper, "'/home/mara/.coders-talk/bin/coders-talk' mcp-headers");
    assert.match(posix['skills/build/SKILL.md'], /'\/home\/mara\/\.coders-talk\/bin\/coders-talk' preview \$\{CLAUDE_SESSION_ID\}/);
    assert.doesNotMatch(posix['skills/build/SKILL.md'], /In PowerShell/);
    assert.match(posix['codex/skills/build/SKILL.md'], /^Run every command outside the sandbox/m, 'the sentence about <plugin> is gone');
    assert.match(posix['codex/skills/build/SKILL.md'], /If the command is not found, Coders Talk was removed from this computer/);
});

test('an agent that keeps its own Coders Talk server gets the plugin without one', () => {
    const files = lay(false, POSIX, { claude: false });
    assert.equal(files['.mcp.json'], undefined);
    assert.equal(JSON.parse(files['.codex-plugin/plugin.json']).mcpServers, './codex/mcp.json');
    assert.equal(JSON.parse(files['codex/mcp.json']).mcpServers['coders-talk'].url, 'https://coders.talk/mcp');

    const noCodex = lay(false, POSIX, { codex: false });
    assert.ok(noCodex['.mcp.json']);
    assert.equal(noCodex['codex/mcp.json'], undefined);
    assert.equal(JSON.parse(noCodex['.codex-plugin/plugin.json']).mcpServers, undefined);
});

test('quoting for each shell', () => {
    assert.equal(shCommand(["/a b/it's"]), `'/a b/it'\\''s'`);
    assert.equal(psCommand(["C:\\a b\\it's.exe", 'x']), `& 'C:\\a b\\it''s.exe' 'x'`);
    assert.equal(cmdCommand(['C:\\a\\x.exe', 'C:\\a b\\y']), 'C:\\a\\x.exe "C:\\a b\\y"');
});
