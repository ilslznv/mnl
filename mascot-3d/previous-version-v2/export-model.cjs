const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/Eli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3001/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mascot?.ready);
  const meshes = await page.evaluate(() => window.__mascot.model.children.map(mesh => ({
    name: mesh.name,
    front: Boolean(mesh.material.map),
    attributes: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key, value]) => [key, { data: Array.from(value.array), itemSize: value.itemSize, count: value.count }])),
  })));
  await browser.close();
  const gltf = {
    asset: { version: '2.0', generator: 'Manool reference reconstruction' },
    scene: 0, scenes: [{ name: 'Manool', nodes: [] }], nodes: [], meshes: [],
    buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [],
    extensionsUsed: ['KHR_materials_unlit'],
    materials: [
      { name: 'Reference pigment', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'BLEND' },
      { name: 'Reconstructed back', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } },
    ],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }], images: [],
    cameras: [{ name: 'Reference view', type: 'orthographic', orthographic: { xmag: 1.91, ymag: 1.555, znear: 0.1, zfar: 50 } }],
    extras: { sourceImage: 'reference.png', note: 'Static reference pose. Cursor-driven eyes are implemented in the Three.js scene. The back is reconstructed from the single supplied view.' },
  };
  const chunks = [];
  let byteLength = 0;
  function view(buffer, target) {
    const index = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length, ...(target ? { target } : {}) });
    const padding = (4 - buffer.length % 4) % 4;
    chunks.push(buffer, Buffer.alloc(padding));
    byteLength += buffer.length + padding;
    return index;
  }
  const semantics = { position: 'POSITION', normal: 'NORMAL', uv: 'TEXCOORD_0', color: 'COLOR_0' };
  for (const mesh of meshes) {
    const attributes = {};
    for (const [name, attribute] of Object.entries(mesh.attributes)) {
      if (!semantics[name]) continue;
      const data = new Float32Array(attribute.data);
      // glTF images use a top-left UV origin; Three.js textures are flipped at upload.
      if (name === 'uv') for (let i = 1; i < data.length; i += 2) data[i] = 1 - data[i];
      const accessor = { bufferView: view(Buffer.from(data.buffer), 34962), componentType: 5126, count: attribute.count, type: `VEC${attribute.itemSize}` };
      if (name === 'position') {
        accessor.min = [Infinity, Infinity, Infinity]; accessor.max = [-Infinity, -Infinity, -Infinity];
        data.forEach((v, i) => { const axis = i % 3; accessor.min[axis] = Math.min(accessor.min[axis], v); accessor.max[axis] = Math.max(accessor.max[axis], v); });
      }
      attributes[semantics[name]] = gltf.accessors.push(accessor) - 1;
    }
    const meshId = gltf.meshes.push({ name: mesh.name, primitives: [{ attributes, mode: 4, material: mesh.front ? 0 : 1 }] }) - 1;
    const nodeId = gltf.nodes.push({ name: mesh.name, mesh: meshId }) - 1;
    gltf.scenes[0].nodes.push(nodeId);
  }
  gltf.scenes[0].nodes.push(gltf.nodes.push({ name: 'Reference view', camera: 0, translation: [0, 0, 12] }) - 1);
  const imageView = view(fs.readFileSync(path.join(__dirname, 'assets/reference.png')));
  gltf.images.push({ bufferView: imageView, mimeType: 'image/png' });
  gltf.buffers[0].byteLength = byteLength;
  const jsonRaw = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.concat([jsonRaw, Buffer.alloc((4 - jsonRaw.length % 4) % 4, 0x20)]);
  const binary = Buffer.concat(chunks);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const result = Buffer.concat([header, jsonHeader, json, binHeader, binary]);
  const destination = path.join(__dirname, 'manool.glb');
  fs.writeFileSync(destination, result);
  if (result.readUInt32LE(8) !== result.length || gltf.meshes.length !== 6) throw new Error('GLB validation failed.');
  console.log(JSON.stringify({ file: destination, bytes: result.length, meshes: gltf.meshes.length, embeddedTextures: gltf.images.length }));
})();
