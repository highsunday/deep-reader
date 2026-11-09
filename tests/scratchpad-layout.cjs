// Run with: npx electron tests/scratchpad-layout.cjs
// Real Chromium layout: jsdom does not reliably evaluate the :has/inset combination.
const { app, BrowserWindow } = require('electron');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 800 });
  try {
    const css = readFileSync(join(__dirname, '../src/renderer/chapter-scratchpad.css'), 'utf8');
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>
      * { box-sizing: border-box } body { margin: 0 }
      .reader-panel { position: relative; width: 800px; height: 700px; --subheader-height: 48px }
      ${css}</style><div class="reader-panel"><div class="chapter-scratchpad-layer">
      <button class="chapter-scratchpad-launch"></button>
      <section class="chapter-scratchpad" style="left:0;top:100%;transform:translateY(-100%)"></section>
      </div></div>`));
    const results = await win.webContents.executeJavaScript(`(() => {
      const reader = document.querySelector('.reader-panel');
      const layer = document.querySelector('.chapter-scratchpad-layer');
      const panel = document.querySelector('.chapter-scratchpad');
      const launcher = document.querySelector('.chapter-scratchpad-launch');
      const checks = [];
      for (const width of [800, 360]) {
        reader.style.width = width + 'px';
        for (const expanded of [false, true]) {
          panel.classList.toggle('expanded', expanded);
          for (const progress of [false, true]) {
            const toast = document.createElement('div');
            toast.className = 'memory-image-generation-progress';
            if (progress) reader.append(toast);
            const r = reader.getBoundingClientRect(), p = panel.getBoundingClientRect();
            checks.push({ width, expanded, progress, bottom: r.bottom - p.bottom,
              left: p.left - r.left, launcherLeft: launcher.getBoundingClientRect().left - r.left,
              inside: p.right <= r.right && p.top >= r.top + 48 });
            toast.remove();
          }
        }
      }
      return checks;
    })()`);
    console.log(JSON.stringify(results, null, 2));
    if (results.some(r => r.bottom !== 12 || r.left !== 12 || r.launcherLeft !== 16 || !r.inside)) {
      throw new Error('Scratchpad must reach the lower left with 12px margins, regardless of generation progress.');
    }
    console.log('PASS: 8 Chromium layout scenarios');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
