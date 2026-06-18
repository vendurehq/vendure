const fs = require('fs');
const path = require('path');

// Read the vendure-config.ts file
const configPath = path.join(process.cwd(), 'src', 'vendure-config.ts');
let configContent = fs.readFileSync(configPath, 'utf-8');

// Add the import statement at the top of the file
const importStatement = `import { TestPlugin } from './plugins/test-plugin/test.plugin';\n`;
configContent = importStatement + configContent;

// Add TestPlugin to the plugins array
// First, find the plugins array in the config
const pluginsMatch = configContent.match(/plugins:\s*\[([\s\S]*?)\]/);
if (pluginsMatch) {
    const existingPlugins = pluginsMatch[1].trim();
    // Replace the existing plugins array with the updated one including TestPlugin
    const updatedPlugins = existingPlugins
        ? `${existingPlugins.replace(/,\s*$/, '')},\n        TestPlugin`
        : 'TestPlugin';
    configContent = configContent.replace(/plugins:\s*\[([\s\S]*?)\]/, `plugins: [${updatedPlugins}]`);
}

// Write the modified content back to the file
fs.writeFileSync(configPath, configContent);
