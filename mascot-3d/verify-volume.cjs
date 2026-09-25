const { chromium } = require('C:/Users/Eli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:3001/', { waitUntil: 'networkidle' });
  try { await page.waitForFunction(() => window.__mascot?.ready, { timeout: 15000 }); }
  catch (error) { console.log(JSON.stringify({ errors, failed: error.message })); await browser.close(); process.exit(1); }
  for (const [name, yaw, pitch] of [
    ['front', 0, 0], ['side-right', Math.PI / 2, 0], ['back', Math.PI, 0], ['side-left', -Math.PI / 2, 0],
    ['rear-right', Math.PI * 0.72, 0.10], ['rear-left', -Math.PI * 0.72, 0.10], ['three-quarter', 0.62, 0], ['top', Math.PI, 0.75],
  ]) {
    await page.evaluate(({ yaw, pitch }) => window.__mascot.setView(yaw, pitch), { yaw, pitch });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(__dirname, `volume-${name}.png`) });
  }
  const meshData = await page.evaluate(() => window.__mascot.model.children.map(mesh => ({
    name: mesh.name,
    positions: Array.from(mesh.geometry.attributes.position.array),
    map: Boolean(mesh.material.map),
    uv: Array.from(mesh.geometry.attributes.uv.array),
    mapSize: [mesh.material.map.image.width, mesh.material.map.image.height],
    materialType: mesh.material.type,
  })));
  const metrics = [];
  for (let part = 0; part < meshData.length; part += 2) {
    const meshes = meshData.slice(part, part + 2), edges = new Map();
    const counts = [], areas = [];
    for (const mesh of meshes) {
      const positions = mesh.positions;
      let area = 0;
      for (let i = 0; i < positions.length; i += 9) {
        const a = positions.slice(i, i + 3), b = positions.slice(i + 3, i + 6), c = positions.slice(i + 6, i + 9);
        const u = b.map((v, j) => v - a[j]), v = c.map((v, j) => v - a[j]);
        area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
        const keys = [a, b, c].map(point => point.map(value => value.toFixed(5)).join(','));
        for (let j = 0; j < 3; j++) {
          const edge = [keys[j], keys[(j + 1) % 3]].sort().join('|');
          edges.set(edge, (edges.get(edge) || 0) + 1);
        }
      }
      counts.push(positions.length / 9); areas.push(area);
    }
    metrics.push({ name: meshes[0].name.split(' — ')[0], triangleCounts: counts, areas, densityRatio: (counts[1] / areas[1]) / (counts[0] / areas[0]), nonManifoldEdges: [...edges.values()].filter(count => count !== 2).length });
  }
  const rear = meshData[1], rearVertices = [];
  for (let i = 0; i < rear.positions.length; i += 3) rearVertices.push(rear.positions.slice(i, i + 3));
  let maxFold = 0;
  for (let i = 0; i < rearVertices.length; i += 3) {
    const [a, b, c] = rearVertices.slice(i, i + 3);
    const u = b.map((v, j) => v - a[j]), v = c.map((w, j) => w - a[j]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    for (const point of rearVertices) maxFold = Math.max(maxFold, point.reduce((sum, value, j) => sum + (value - a[j]) * n[j] / length, 0));
  }
  const texelScale = [];
  for (let part = 1; part < meshData.length; part += 2) {
    const mesh = meshData[part];
    for (let i = 0; i < mesh.positions.length / 3; i += 3) for (let j = 0; j < 3; j++) {
      const a = i + j, b = i + (j + 1) % 3;
      const worldLength = Math.hypot(...[0, 1, 2].map(k => mesh.positions[a * 3 + k] - mesh.positions[b * 3 + k]));
      const pixelLength = Math.hypot(...[0, 1].map(k => (mesh.uv[a * 2 + k] - mesh.uv[b * 2 + k]) * mesh.mapSize[k]));
      texelScale.push(pixelLength / worldLength);
    }
  }
  await page.setViewportSize({ width: 382, height: 311 });
  await page.evaluate(() => window.__mascot.setReferenceCamera(true));
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(__dirname, 'reference-match.png') });
  const result = { errors, meshes: meshData.map(({ positions, uv, ...mesh }) => mesh), metrics, rearMaxInwardFold: maxFold, texelsPerUnit: { min: Math.min(...texelScale), max: Math.max(...texelScale) },
    assertions: { noErrors: !errors.length, convexRear: maxFold < 0.00001, unstretchedRearUV: texelScale.every(scale => Math.abs(scale - 100) < 0.01), closedParts: metrics.every(part => part.nonManifoldEdges === 0), consistentHeadDensity: metrics[0].densityRatio > 0.7 && metrics[0].densityRatio < 1.4, allTextured: meshData.every(mesh => mesh.map), sameShadingModel: meshData.every(mesh => mesh.materialType === 'MeshBasicMaterial') },
  };
  fs.writeFileSync(path.join(__dirname, 'volume-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (!Object.values(result.assertions).every(Boolean)) process.exitCode = 1;
})();
