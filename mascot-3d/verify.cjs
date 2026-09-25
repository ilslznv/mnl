const { chromium } = require('C:/Users/Eli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:3001/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mascot?.ready);
  await page.screenshot({ path: path.join(__dirname, 'preview.png') });
  const read = () => page.evaluate(() => ({
    pupils: window.__mascot.eyes.map(eye => ({ x: eye.gaze.x, y: eye.gaze.y, vertices: eye.pupil.geometry.drawRange.count })),
    triangles: window.__mascot.renderer.info.render.triangles,
    geometries: window.__mascot.renderer.info.memory.geometries,
    canvasCount: document.querySelectorAll('canvas').length,
    visibleText: document.body.innerText,
    buttons: document.querySelectorAll('button,a,input,nav,header').length,
    yaw: window.__mascot.model.rotation.y,
  }));
  const initial = await read();
  await page.mouse.move(80, 150);
  await page.waitForTimeout(450);
  const left = await read();
  await page.screenshot({ path: path.join(__dirname, 'gaze-left.png') });
  await page.mouse.move(1360, 950);
  await page.waitForTimeout(450);
  const right = await read();
  await page.screenshot({ path: path.join(__dirname, 'gaze-right.png') });
  await page.mouse.move(700, 550);
  await page.mouse.down();
  await page.mouse.move(1230, 550, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const rotated = await read();
  await page.screenshot({ path: path.join(__dirname, 'back.png') });
  await page.mouse.dblclick(720, 540);
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(__dirname, 'mobile.png') });
  const result = {
    errors, initial, left, right, rotated,
    assertions: {
      noErrors: errors.length === 0,
      onlyCanvas: initial.canvasCount === 1 && initial.visibleText === '' && initial.buttons === 0,
      realGeometry: initial.triangles > 300,
      gazeTracksX: right.pupils.every((p, i) => p.x > left.pupils[i].x + 0.1),
      gazeTracksY: left.pupils.every((p, i) => p.y > right.pupils[i].y + 0.1),
      noGeometryLeak: initial.geometries === right.geometries,
      rotates: rotated.yaw > initial.yaw + 2,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!Object.values(result.assertions).every(Boolean)) process.exitCode = 1;
})();
