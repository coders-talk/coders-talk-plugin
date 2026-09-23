/**
 * The plugin's own options as Claude Code saved them (settings.json → pluginConfigs["coders-talk@<marketplace>"]).
 * Read here directly: ${user_config.*} placeholders in skills are not expanded everywhere (the desktop app left
 * them as they were), and the CLAUDE_PLUGIN_OPTION_* variables did not reach commands the model runs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './session.mjs';

export function pluginOption(name, dir = configDir()) {
    let settings;
    try {
        settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    } catch {
        return null;
    }
    for (const [id, config] of Object.entries(settings?.pluginConfigs ?? {})) {
        if (id.startsWith('coders-talk@') && typeof config?.options?.[name] === 'string' && config.options[name].trim() !== '') {
            return config.options[name].trim();
        }
    }

    return null;
}
