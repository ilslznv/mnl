import * as THREE from 'three';

// The reference camera is calibrated in source-image pixels. The mesh has
// independent depth at every landmark and a closed, sculpted back volume.
const SOURCE_WIDTH = 382;
const SOURCE_HEIGHT = 311;
const UNIT = 100;
const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-3, 3, 2.4, -2.4, 0.1, 50);
camera.position.set(0, 0, 12);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffdfbd, 0x521b0e, 2));
const key = new THREE.DirectionalLight(0xffeddc, 2.1);
key.position.set(-3, 5, 7);
scene.add(key);

const model = new THREE.Group();
model.name = 'Manool — reference reconstruction';
scene.add(model);

const texture = await new THREE.TextureLoader().loadAsync('./assets/reference.png');
texture.colorSpace = THREE.SRGBColorSpace;
texture.minFilter = THREE.LinearFilter;
texture.magFilter = THREE.LinearFilter;
texture.generateMipmaps = false;
const bitmap = document.createElement('canvas');
bitmap.width = SOURCE_WIDTH;
bitmap.height = SOURCE_HEIGHT;
const context = bitmap.getContext('2d', { willReadFrequently: true });
context.drawImage(texture.image, 0, 0);
const original = context.getImageData(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT);

function worldPoint(point) {
  return [(point[0] - SOURCE_WIDTH / 2) / UNIT, (SOURCE_HEIGHT / 2 - point[1]) / UNIT, point[2]];
}

function inside(point, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

// Individual vertices follow the silhouette and visible facet junctions.
const headPoints = [
  [0, 109, -0.55], [67, 79, -0.36], [113, 61, -0.09],
  [168, 46, -0.04], [222, 51, 0.10], [287, 72, 0.30],
  [377, 149, 0.44], [382, 195, 0.42], [344, 253, 0.36],
  [239, 300, 0.24], [203, 308, -0.02], [48, 298, -0.60],
  [0, 286, -0.94], [0, 178, -0.75],
  [11, 151, -0.54], [68, 230, -0.24], [135, 110, 0.19],
  [122, 177, 0.39], [153, 167, 0.67], [206, 155, 1.01],
  [279, 175, 1.29], [333, 149, 0.89], [276, 206, 1.25],
  [217, 234, 1.01], [338, 223, 0.79], [217, 259, 0.73],
  [178, 190, 0.92], [316, 180, 1.03], [259, 107, 0.70],
];
const headBoundaryCount = 14;

function weights(point, a, b, c) {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const u = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const v = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  return [u, v, 1 - u - v];
}

function triangulate(points, boundaryCount) {
  let triangles = THREE.ShapeUtils.triangulateShape(points.slice(0, boundaryCount).map(p => new THREE.Vector2(p[0], p[1])), []);
  for (let id = boundaryCount; id < points.length; id++) {
    const next = [];
    let inserted = false;
    for (const [a, b, c] of triangles) {
      const w = weights(points[id], points[a], points[b], points[c]);
      if (w.every(value => value >= -0.00001)) {
        inserted = true;
        const edge = w.findIndex(value => Math.abs(value) < 0.00001);
        if (edge === 0) next.push([a, b, id], [a, id, c]);
        else if (edge === 1) next.push([b, c, id], [b, id, a]);
        else if (edge === 2) next.push([c, a, id], [c, id, b]);
        else next.push([a, b, id], [b, c, id], [c, a, id]);
      } else next.push([a, b, c]);
    }
    if (!inserted) throw new Error(`Landmark ${id} is outside the mesh.`);
    triangles = next;
  }

  // Local edge flips remove long, thin triangles while preserving the traced
  // contour. This gives a continuous convex surface when viewed from the side.
  for (let pass = 0; pass < 100; pass++) {
    const edges = new Map();
    triangles.forEach((face, faceId) => {
      for (let i = 0; i < 3; i++) {
        const a = face[i], b = face[(i + 1) % 3], c = face[(i + 2) % 3];
        const key = [Math.min(a, b), Math.max(a, b)].join(':');
        if (!edges.has(key)) edges.set(key, []);
        edges.get(key).push({ faceId, a, b, c });
      }
    });
    let changed = false;
    const changedFaces = new Set();
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const angle = (a, b, center) => {
      const u = [a[0] - center[0], a[1] - center[1]];
      const v = [b[0] - center[0], b[1] - center[1]];
      return Math.acos(THREE.MathUtils.clamp((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)), -1, 1));
    };
    for (const pair of edges.values()) {
      if (pair.length !== 2) continue;
      const [first, second] = pair;
      if (changedFaces.has(first.faceId) || changedFaces.has(second.faceId)) continue;
      const { a, b, c } = first;
      const d = second.c;
      if (cross(points[c], points[d], points[a]) * cross(points[c], points[d], points[b]) >= -0.00001) continue;
      if (angle(points[a], points[b], points[c]) + angle(points[a], points[b], points[d]) > Math.PI + 0.0001) {
        triangles[first.faceId] = [a, c, d];
        triangles[second.faceId] = [b, d, c];
        changedFaces.add(first.faceId); changedFaces.add(second.faceId);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return triangles.map(face => {
    const [a, b, c] = face.map(id => points[id]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return cross > 0 ? face.toReversed() : face;
  });
}

const leftOutline = [[120, 175], [153, 164], [205, 153], [243, 161], [275, 173], [279, 181], [275, 207], [247, 223], [219, 235], [172, 230], [146, 219], [133, 203], [123, 186]];
const rightOutline = [[278, 174], [299, 158], [333, 147], [358, 152], [378, 165], [381, 193], [368, 209], [349, 221], [319, 221], [298, 214], [280, 204]];
const eyeDefinitions = [
  { outline: leftOutline, center: [190, 190], pupil: [180, 166, 29, 40, -0.23], range: [16, 10] },
  { outline: rightOutline, center: [327, 184], pupil: [315, 161, 23, 39, -0.30], range: [12, 9] },
];

// The image is the UV material of the 3D surface. Separate texture channels
// preserve its exact resting appearance while permitting independent pupils.
const cleaned = new Uint8ClampedArray(original.data);
const pupilData = new Uint8ClampedArray(original.data.length);
const eyeMaskData = new Uint8ClampedArray(original.data.length);
for (let i = 3; i < eyeMaskData.length; i += 4) eyeMaskData[i] = 255;

for (let eyeIndex = 0; eyeIndex < eyeDefinitions.length; eyeIndex++) {
  const eye = eyeDefinitions[eyeIndex];
  const bounds = eyeIndex === 0 ? [119, 150, 277, 237] : [278, 145, 382, 225];
  const [x0, y0, x1, y1] = bounds;
  const core = new Set(), candidates = new Set(), gold = [];
  const columnTops = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * SOURCE_WIDTH + x) * 4;
      const [r, g, b, alpha] = original.data.subarray(offset, offset + 4);
      if (alpha < 100) continue;
      const isGold = r > 90 && g > 80 && g > r * 0.62 && b < g * 0.91;
      const pupilBounds = eyeIndex === 0 ? [148, 152, 217, 211] : [288, 147, 344, 204];
      const isDark = Math.max(r, g, b) < 116 && x >= pupilBounds[0] && x < pupilBounds[2] && y >= pupilBounds[1] && y < pupilBounds[3];
      if (isGold || isDark) {
        eyeMaskData[offset + eyeIndex] = 255;
        if (isGold && Math.max(r, g) > 150 && x % 2 === 0 && y % 2 === 0) gold.push([x, y, r, g, b]);
      }
      if (isDark) {
        core.add(y * SOURCE_WIDTH + x);
        if (!columnTops.has(x)) columnTops.set(x, y);
        for (let yy = y - 2; yy <= y + 2; yy++) {
          for (let xx = x - 2; xx <= x + 2; xx++) {
            if (xx >= x0 && xx < x1 && yy >= y0 && yy < y1) candidates.add(yy * SOURCE_WIDTH + xx);
          }
        }
      }
    }
  }
  for (const pixel of candidates) {
    const index = pixel * 4;
    if (!eyeMaskData[index + eyeIndex]) continue;
    const x = pixel % SOURCE_WIDTH, y = Math.floor(pixel / SOURCE_WIDTH);
    let weight = 0, r = 0, g = 0, b = 0;
    for (const sample of gold) {
      if (candidates.has(sample[1] * SOURCE_WIDTH + sample[0])) continue;
      const distance = (sample[0] - x) ** 2 + (sample[1] - y) ** 2 + 36;
      const w = 1 / (distance * distance);
      weight += w; r += sample[2] * w; g += sample[3] * w; b += sample[4] * w;
    }
    const background = [r / weight, g / weight, b / weight];
    const grain = ((x * 31 + y * 47) % 11 - 5) * 0.3;
    cleaned.set([...background.map(c => c + grain), 255], index);
    if (core.has(pixel)) {
      pupilData.set([...original.data.subarray(index, index + 3), 255], index);
    } else {
      const opacity = THREE.MathUtils.clamp((background[1] - original.data[index + 1]) / (background[1] - 39), 0, 1);
      if (opacity > 0.10) pupilData.set([36, 39, 31, opacity * 255], index);
    }
  }
  // Extend the measured pupil behind its upper eyelid, keeping every visible
  // column continuous when the gaze moves downward.
  for (const [x, top] of columnTops) {
    for (let y = Math.max(100, top - 32); y < top + 2; y++) {
      const index = (y * SOURCE_WIDTH + x) * 4;
      if (!eyeMaskData[index + eyeIndex] || y <= top + 1) pupilData.set([34, 36, 30, 255], index);
    }
  }
}

function dataTexture(data, color = true) {
  const result = new THREE.DataTexture(data, SOURCE_WIDTH, SOURCE_HEIGHT, THREE.RGBAFormat);
  result.flipY = true;
  result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.minFilter = THREE.LinearFilter;
  result.magFilter = THREE.LinearFilter;
  result.generateMipmaps = false;
  result.needsUpdate = true;
  return result;
}

for (let i = 0; i < pupilData.length; i += 4) {
  if (pupilData[i + 3]) { pupilData[i] = 34; pupilData[i + 1] = 36; pupilData[i + 2] = 30; }
}

const eyeUniforms = {
  viewTurn: { value: 0 },
  cleanEyeMap: { value: dataTexture(cleaned) },
  pupilMap: { value: dataTexture(pupilData) },
  eyeMaskMap: { value: dataTexture(eyeMaskData, false) },
  leftGaze: { value: new THREE.Vector2() },
  rightGaze: { value: new THREE.Vector2() },
};
const referenceMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.002, side: THREE.FrontSide, toneMapped: false });
referenceMaterial.name = 'Original reference pigment and calibrated illumination';
referenceMaterial.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, eyeUniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
    varying vec3 vOriginalNormal;
    varying vec3 vCurrentNormal;
  `);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vOriginalNormal = normal;
    vCurrentNormal = mat3(modelMatrix) * normal;
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    uniform float viewTurn;
    uniform sampler2D cleanEyeMap;
    uniform sampler2D pupilMap;
    uniform sampler2D eyeMaskMap;
    uniform vec2 leftGaze;
    uniform vec2 rightGaze;
    varying vec3 vOriginalNormal;
    varying vec3 vCurrentNormal;
    vec3 animatedEye(vec2 uv, vec2 gaze) {
      vec4 pupil = texture2D(pupilMap, uv - gaze / vec2(382.0, 311.0));
      return mix(texture2D(cleanEyeMap, uv).rgb, pupil.rgb, pupil.a);
    }
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
    vec4 texel = texture2D(map, vMapUv);
    if (texel.a < 0.99 && viewTurn > 0.0) {
      vec4 edgeColor = texel;
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          vec4 candidate = texture2D(map, vMapUv + vec2(float(i), float(j)) / vec2(382.0, 311.0));
          if (candidate.a > edgeColor.a) edgeColor = candidate;
        }
      }
      texel.rgb = mix(edgeColor.rgb, texel.rgb, texel.a);
      texel.a = mix(texel.a, 1.0, viewTurn);
    }
    vec2 masks = texture2D(eyeMaskMap, vMapUv).rg;
    if (length(leftGaze) > 0.015) texel.rgb = mix(texel.rgb, animatedEye(vMapUv, leftGaze), masks.r);
    if (length(rightGaze) > 0.015) texel.rgb = mix(texel.rgb, animatedEye(vMapUv, rightGaze), masks.g);
    diffuseColor *= texel;
    vec3 keyDirection = normalize(vec3(-0.35, 0.8, 0.75));
    float referenceLight = 0.55 + 0.45 * max(dot(normalize(vOriginalNormal), keyDirection), 0.0);
    float currentLight = 0.55 + 0.45 * max(dot(normalize(vCurrentNormal), keyDirection), 0.0);
    diffuseColor.rgb *= clamp(currentLight / referenceLight, 0.5, 1.55);
  `);
};

function frontGeometry(points, triangles) {
  const positions = [], uvs = [];
  for (const face of triangles) {
    for (const id of face) {
      positions.push(...worldPoint(points[id]));
      uvs.push(points[id][0] / SOURCE_WIDTH, 1 - points[id][1] / SOURCE_HEIGHT);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

const backMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, side: THREE.FrontSide });

function addVolume(name, points, boundaryCount, backCenter, backDepth, ear = false) {
  const frontTriangles = triangulate(points, boundaryCount);
  const front = new THREE.Mesh(frontGeometry(points, frontTriangles), referenceMaterial);
  front.name = name + ' — calibrated front facets';
  front.renderOrder = 1;
  model.add(front);
  const all = points.slice(0, boundaryCount).map(p => p.slice());
  const scales = ear ? [0.72] : [0.79, 0.43];
  for (let ring = 0; ring < scales.length; ring++) {
    for (const p of points.slice(0, boundaryCount)) {
      all.push([
        backCenter[0] + (p[0] - backCenter[0]) * scales[ring],
        backCenter[1] + (p[1] - backCenter[1]) * scales[ring],
        backDepth + (scales.length - 1 - ring) * (ear ? 0 : 0.37),
      ]);
    }
  }
  const backFaces = [];
  for (let ring = 0; ring < scales.length; ring++) {
    for (let i = 0; i < boundaryCount; i++) {
      const a = ring * boundaryCount + i;
      const b = ring * boundaryCount + (i + 1) % boundaryCount;
      const c = (ring + 1) * boundaryCount + i;
      const d = (ring + 1) * boundaryCount + (i + 1) % boundaryCount;
      backFaces.push([a, b, c], [b, d, c]);
    }
  }
  const centerId = all.push([...backCenter, backDepth - (ear ? 0.045 : 0.10)]) - 1;
  for (let i = 0; i < boundaryCount; i++) backFaces.push([scales.length * boundaryCount + i, scales.length * boundaryCount + (i + 1) % boundaryCount, centerId]);
  const positions = [], colors = [];
  const swatches = ear ? ['#d6502c', '#e36737', '#bb4125', '#c64b2b'] : ['#c64a29', '#d3552e', '#b24126', '#d96236', '#bd472c'];
  backFaces.forEach((face, i) => {
    const color = new THREE.Color(swatches[(i * 7) % swatches.length]);
    for (const id of face) {
      positions.push(...worldPoint(all[id]));
      colors.push(color.r, color.g, color.b);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const back = new THREE.Mesh(geometry, backMaterial);
  back.name = name + ' — closed sides and back';
  model.add(back);
  return { front, back, points, triangles: frontTriangles };
}

const head = addVolume('Head', headPoints, headBoundaryCount, [167, 175], -1.78);
addVolume('Near ear', [[0, 29, -0.52], [74, 53, -0.42], [68, 80, -0.32], [0, 111, -0.54], [20, 70, -0.34]], 4, [31, 77], -0.96, true);
addVolume('Upper ear', [[84, 0, -0.10], [169, 46, -0.05], [114, 63, 0.02], [68, 81, -0.34], [110, 43, 0.12]], 4, [108, 46], -0.51, true);

function headDepth(x, y) {
  for (const face of head.triangles) {
    const p = face.map(id => headPoints[id]);
    const w = weights([x, y], ...p);
    if (w.every(value => value >= -0.00001)) return w.reduce((sum, value, i) => sum + value * p[i][2], 0);
  }
  return 1;
}
const eyes = eyeDefinitions.map((definition, index) => ({
  gaze: index ? eyeUniforms.rightGaze.value : eyeUniforms.leftGaze.value,
  target: new THREE.Vector2(),
  origin: new THREE.Vector3(...worldPoint([...definition.center, headDepth(...definition.center)])),
  range: definition.range,
}));

const pointer = new THREE.Vector2();
let pointerActive = false;
const projectedEye = new THREE.Vector3();
const drag = { active: false, x: 0, y: 0, yaw: 0, pitch: 0 };
let targetYaw = 0, targetPitch = 0;
let comparisonCamera = false;

function updatePointer(event) {
  pointer.set(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2);
  pointerActive = true;
}
window.addEventListener('pointermove', event => {
  updatePointer(event);
  if (drag.active) {
    targetYaw = drag.yaw + (event.clientX - drag.x) * 0.006;
    targetPitch = THREE.MathUtils.clamp(drag.pitch + (event.clientY - drag.y) * 0.005, -1.15, 1.15);
  }
}, { passive: true });
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  updatePointer(event);
  Object.assign(drag, { active: true, x: event.clientX, y: event.clientY, yaw: targetYaw, pitch: targetPitch });
  canvas.setPointerCapture(event.pointerId);
});
const endDrag = () => { drag.active = false; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);
function neutralGaze() { pointerActive = false; }
document.documentElement.addEventListener('pointerleave', () => { if (!drag.active) neutralGaze(); });
window.addEventListener('blur', () => { neutralGaze(); endDrag(); });
function resetView(immediate = false) {
  targetYaw = 0;
  targetPitch = 0;
  neutralGaze();
  if (immediate) {
    model.rotation.set(0, 0, 0);
    eyes.forEach(eye => { eye.gaze.set(0, 0); eye.target.set(0, 0); });
  }
}
canvas.addEventListener('dblclick', () => resetView());

function resize() {
  const aspect = innerWidth / innerHeight;
  const viewHeight = comparisonCamera ? SOURCE_HEIGHT / UNIT : Math.max(SOURCE_HEIGHT / UNIT / 0.72, SOURCE_WIDTH / UNIT / (aspect * 0.80));
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
window.addEventListener('resize', resize, { passive: true });
resize();

let previousTime = 0;
function render(time) {
  const dt = Math.min((time - previousTime) / 1000 || 1 / 60, 0.05);
  previousTime = time;
  const ease = 1 - Math.exp(-dt * 12);
  model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, targetYaw, ease);
  model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, targetPitch, ease);
  if (Math.abs(model.rotation.y - targetYaw) < 0.00001) model.rotation.y = targetYaw;
  if (Math.abs(model.rotation.x - targetPitch) < 0.00001) model.rotation.x = targetPitch;
  eyeUniforms.viewTurn.value = Math.min(1, (Math.abs(model.rotation.x) + Math.abs(model.rotation.y)) * 10);
  model.updateMatrixWorld(true);
  for (const eye of eyes) {
    if (pointerActive && !drag.active) {
      projectedEye.copy(eye.origin).applyMatrix4(model.matrixWorld).project(camera);
      const horizontalSign = Math.cos(model.rotation.y) >= 0 ? 1 : -1;
      eye.target.set(
        Math.tanh((pointer.x - projectedEye.x) * 1.6) * eye.range[0] * horizontalSign,
        Math.tanh((pointer.y - projectedEye.y) * 1.65) * eye.range[1],
      );
    } else eye.target.set(0, 0);
    eye.gaze.lerp(eye.target, ease);
    if (eye.gaze.distanceToSquared(eye.target) < 0.00002) eye.gaze.copy(eye.target);
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(render);

window.__mascot = {
  scene, camera, renderer, model, eyes, head,
  get ready() { return renderer.info.render.triangles > 0; },
  resetView,
  setReferenceCamera(enabled) { comparisonCamera = enabled; resetView(true); resize(); },
};
