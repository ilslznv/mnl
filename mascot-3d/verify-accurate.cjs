const { chromium } = require('C:/Users/Eli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:3001/', { waitUntil: 'networkidle' });
  try { await page.waitForFunction(() => window.__mascot?.ready, { timeout: 15000 }); }
  catch (error) { console.log(JSON.stringify({ errors, failed: error.message })); await browser.close(); process.exit(1); }
  await page.screenshot({ path: path.join(__dirname, 'preview.png') });
  const read = () => page.evaluate(() => {
    const model = window.__mascot;
    let minZ = Infinity, maxZ = -Infinity;
    model.model.traverse(mesh => {
      if (!mesh.geometry) return;
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) { minZ = Math.min(minZ, positions.getZ(i)); maxZ = Math.max(maxZ, positions.getZ(i)); }
    });
    return {
      pupils: model.eyes.map(eye => ({ x: eye.gaze.x, y: eye.gaze.y })),
      triangles: model.renderer.info.render.triangles,
      geometries: model.renderer.info.memory.geometries,
      textures: model.renderer.info.memory.textures,
      depth: maxZ - minZ,
      canvasCount: document.querySelectorAll('canvas').length,
      visibleText: document.body.innerText,
      controls: document.querySelectorAll('button,a,input,nav,header').length,
      yaw: model.model.rotation.y,
    };
  });
  const initial = await read();
  await page.mouse.move(60, 100);
  await page.waitForTimeout(450);
  const left = await read();
  await page.screenshot({ path: path.join(__dirname, 'gaze-left.png') });
  await page.mouse.move(1380, 980);
  await page.waitForTimeout(450);
  const right = await read();
  await page.screenshot({ path: path.join(__dirname, 'gaze-right.png') });
  await page.mouse.move(650, 540);
  await page.mouse.down();
  await page.mouse.move(1174, 540, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const back = await read();
  await page.screenshot({ path: path.join(__dirname, 'back.png') });
  await page.evaluate(() => { window.__mascot.resetView(true); });
  await page.mouse.move(650, 540);
  await page.mouse.down();
  await page.mouse.move(830, 530, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(__dirname, 'side.png') });
  await page.mouse.dblclick(720, 540);
  await page.waitForTimeout(700);
  const reset = await read();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(__dirname, 'mobile.png') });
  await page.setViewportSize({ width: 382, height: 311 });
  await page.evaluate(() => { window.__mascot.setReferenceCamera(true); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, 'reference-match.png') });
  const result = { errors, initial, left, right, back, reset,
    assertions: {
      noErrors: errors.length === 0,
      onlyCanvas: initial.canvasCount === 1 && initial.visibleText === '' && initial.controls === 0,
      volumetricMesh: initial.depth > 2 && initial.depth < 3.2 && initial.triangles >= 90,
      gazeTracksX: right.pupils.every((p, i) => p.x > left.pupils[i].x + 10),
      gazeTracksY: left.pupils.every((p, i) => p.y > right.pupils[i].y + 10),
      noResourceLeak: initial.geometries === right.geometries && initial.textures === right.textures,
      rotates: back.yaw > 3,
      referenceResets: Math.abs(reset.yaw) < 0.01 && reset.pupils.every(p => Math.abs(p.x) + Math.abs(p.y) < 0.1),
    },
  };
  fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!Object.values(result.assertions).every(Boolean)) process.exitCode = 1;
})();
