const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/Eli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3001/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mascot?.ready);
  const extracted = await page.evaluate(() => {
    const textureIds = new Map(), textures = [];
    const meshes = window.__mascot.model.children.map(mesh => {
      const front = mesh.renderOrder === 1;
      const map = mesh.material.map;
      if (!textureIds.has(map.id)) {
        let png = null;
        if (!front) {
          const canvas = document.createElement('canvas');
          canvas.width = map.image.width; canvas.height = map.image.height;
          canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(map.image.data), canvas.width, canvas.height), 0, 0);
          png = canvas.toDataURL('image/png').split(',')[1];
        }
        textureIds.set(map.id, textures.length);
        textures.push({ name: front ? 'Original reference' : mesh.name, front, png });
      }
      const attributes = Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key, value]) => [key, { data: Array.from(value.array), itemSize: value.itemSize, count: value.count }]));
      if (!front) {
        const normals = attributes.normal.data, colors = [];
        const length = Math.hypot(-0.35, 0.8, 0.75);
        for (let i = 0; i < normals.length; i += 3) {
          const light = 0.36 + 0.64 * Math.max(0, (normals[i] * 0.35 + normals[i + 1] * 0.8 - normals[i + 2] * 0.75) / length);
          colors.push(light, light, light);
        }
        attributes.color = { data: colors, itemSize: 3, count: attributes.position.count };
      }
      return { name: mesh.name, texture: textureIds.get(map.id), attributes };
    });
    return { meshes, textures };
  });
  await browser.close();
  const gltf = {
    asset: { version: '2.0', generator: 'Manool — coherent volume revision' },
    scene: 0, scenes: [{ name: 'Manool', nodes: [] }], nodes: [], meshes: [],
    buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [],
    extensionsUsed: ['KHR_materials_unlit'], materials: [], textures: [], images: [],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    cameras: [{ name: 'Reference view', type: 'orthographic', orthographic: { xmag: 1.91, ymag: 1.555, znear: 0.1, zfar: 50 } }],
    extras: { sourceImage: 'reference.png', note: 'Closed head and thin closed ears. The rear has a convex coarse cage, individually unwrapped facets at 100 texels per world unit, and quilted pigment sampled from the original forehead. Cursor-driven eyes remain in the Three.js scene.' },
  };
  const chunks = [];
  let byteLength = 0;
  function view(buffer, target) {
    const index = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length, ...(target ? { target } : {}) });
    const padding = (4 - buffer.length % 4) % 4;
    chunks.push(buffer, Buffer.alloc(padding)); byteLength += buffer.length + padding;
    return index;
  }
  for (const [index, texture] of extracted.textures.entries()) {
    const png = texture.front ? fs.readFileSync(path.join(__dirname, 'assets/reference.png')) : Buffer.from(texture.png, 'base64');
    gltf.images.push({ name: texture.name, bufferView: view(png), mimeType: 'image/png' });
    gltf.textures.push({ source: index, sampler: 0 });
    gltf.materials.push({ name: texture.name, extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index }, metallicFactor: 0, roughnessFactor: 1 }, ...(texture.front ? { alphaMode: 'BLEND' } : {}) });
  }
  const semantics = { position: 'POSITION', normal: 'NORMAL', uv: 'TEXCOORD_0', color: 'COLOR_0' };
  for (const mesh of extracted.meshes) {
    const attributes = {};
    for (const [name, attribute] of Object.entries(mesh.attributes)) {
      if (!semantics[name]) continue;
      const data = new Float32Array(attribute.data);
      if (name === 'uv') for (let i = 1; i < data.length; i += 2) data[i] = 1 - data[i];
      const accessor = { bufferView: view(Buffer.from(data.buffer), 34962), componentType: 5126, count: attribute.count, type: `VEC${attribute.itemSize}` };
      if (name === 'position') {
        accessor.min = [Infinity, Infinity, Infinity]; accessor.max = [-Infinity, -Infinity, -Infinity];
        data.forEach((v, i) => { accessor.min[i % 3] = Math.min(accessor.min[i % 3], v); accessor.max[i % 3] = Math.max(accessor.max[i % 3], v); });
      }
      attributes[semantics[name]] = gltf.accessors.push(accessor) - 1;
    }
    const meshId = gltf.meshes.push({ name: mesh.name, primitives: [{ attributes, mode: 4, material: mesh.texture }] }) - 1;
    gltf.scenes[0].nodes.push(gltf.nodes.push({ name: mesh.name, mesh: meshId }) - 1);
  }
  gltf.scenes[0].nodes.push(gltf.nodes.push({ name: 'Reference view', camera: 0, translation: [0, 0, 12] }) - 1);
  gltf.buffers[0].byteLength = byteLength;
  const jsonRaw = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.concat([jsonRaw, Buffer.alloc((4 - jsonRaw.length % 4) % 4, 0x20)]);
  const binary = Buffer.concat(chunks);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const result = Buffer.concat([header, jsonHeader, json, binHeader, binary]);
  if (result.readUInt32LE(8) !== result.length || gltf.meshes.length !== 6 || gltf.images.length !== 4) throw new Error('GLB validation failed.');
  fs.writeFileSync(path.join(__dirname, 'manool.glb'), result);
  console.log(JSON.stringify({ file: 'manool.glb', bytes: result.length, meshes: gltf.meshes.length, embeddedTextures: gltf.images.length }));
})();
