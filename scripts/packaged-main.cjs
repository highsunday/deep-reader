// Finder starts apps with an arbitrary working directory. The video runtimes
// resolve their optional dependencies relative to the packaged application.
const { app } = require('electron');
const { join } = require('node:path');
process.chdir(join(__dirname, '..'));
// Preserve the library and notes created by development versions of the app.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'reader-ai-range-chat-example'));
}
require('../dist-electron/main.cjs');
