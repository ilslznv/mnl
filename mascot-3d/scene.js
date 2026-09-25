import * as THREE from 'three';

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x080808);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
camera.position.set(0, 0.55, 11);
camera.lookAt(0, 0.26, 0);

scene.add(new THREE.HemisphereLight(0xfff3da, 0x59291b, 1.7));
const key = new THREE.DirectionalLight(0xffe0bb, 2.3);
key.position.set(-3, 6, 7);
scene.add(key);
const fill = new THREE.DirectionalLight(0xff7842, 0.55);
fill.position.set(5, 1, 4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffc08f, 1.5);
rim.position.set(1, 4, -4);
scene.add(rim);

const mascot = new THREE.Group();
mascot.name = 'Manool';
mascot.rotation.set(0.12, 0.52, -0.045);
scene.add(mascot);

// Seeded colours keep the hand-built facets stable on every load.
let seed = 4209;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

function matte(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, ...extra });
}

// Fine, object-space pigment variation, with no image billboard or baked lighting.
const orange = matte(0xf15b2d, { flatShading: true, vertexColors: true });
orange.onBeforeCompile = shader => {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPigmentPosition;');
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPigmentPosition = position;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    varying vec3 vPigmentPosition;
    float pigmentHash(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.11, 0.37, 0.63));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float pigmentNoise(vec3 p) {
      vec3 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(pigmentHash(i), pigmentHash(i + vec3(1,0,0)), f.x),
                     mix(pigmentHash(i + vec3(0,1,0)), pigmentHash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(pigmentHash(i + vec3(0,0,1)), pigmentHash(i + vec3(1,0,1)), f.x),
                     mix(pigmentHash(i + vec3(0,1,1)), pigmentHash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    float pigment = pigmentNoise(vPigmentPosition * 18.0) * 0.065 + pigmentNoise(vPigmentPosition * 55.0) * 0.025;
    diffuseColor.rgb *= 0.95 + pigment;
  `);
};

function facetedGeometry(vertices, faces, variation = 0.14) {
  const positions = [], colors = [];
  for (const face of faces) {
    const brightness = 1 - variation / 2 + random() * variation;
    for (const index of face) {
      positions.push(...vertices[index]);
      colors.push(brightness, brightness, brightness);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Closed rings, a flat underside, and a broad face form a complete solid head.
const rings = [
  { y: -1.08, x: 1.55, z: 0.90, offset: -0.12 },
  { y: -0.78, x: 2.02, z: 1.23, offset: -0.06 },
  { y: -0.10, x: 2.17, z: 1.43, offset: 0.00 },
  { y:  0.57, x: 1.96, z: 1.27, offset: -0.09 },
  { y:  1.06, x: 1.46, z: 0.88, offset: -0.20 },
  { y:  1.18, x: 0.76, z: 0.51, offset: -0.25 },
];
const segments = 12;
const vertices = [], faces = [];
for (let r = 0; r < rings.length; r++) {
  const ring = rings[r];
  for (let i = 0; i < segments; i++) {
    const angle = i / segments * Math.PI * 2;
    vertices.push([Math.cos(angle) * ring.x, ring.y, Math.sin(angle) * ring.z + ring.offset]);
  }
}
for (let r = 0; r < rings.length - 1; r++) {
  for (let i = 0; i < segments; i++) {
    const a = r * segments + i;
    const b = r * segments + (i + 1) % segments;
    const c = (r + 1) * segments + i;
    const d = (r + 1) * segments + (i + 1) % segments;
    if ((i + r) % 2) faces.push([a, c, b], [b, c, d]);
    else faces.push([a, d, b], [a, c, d]);
  }
}
const bottom = vertices.push([0, -1.13, -0.12]) - 1;
const top = vertices.push([0, 1.22, -0.25]) - 1;
for (let i = 0; i < segments; i++) {
  faces.push([bottom, i, (i + 1) % segments]);
  faces.push([top, (rings.length - 1) * segments + (i + 1) % segments, (rings.length - 1) * segments + i]);
}
const head = new THREE.Mesh(facetedGeometry(vertices, faces), orange);
head.name = 'Closed faceted head';
mascot.add(head);

// Thick triangular ears have front, back, and interior faces.
function addEar(side) {
  const earVertices = [
    [side * 1.83, 0.49, -0.12],
    [side * 0.57, 0.94, -0.21],
    [side * 1.42, 1.73, -0.75],
    [side * 1.85, 0.48, -0.74],
    [side * 0.65, 0.94, -0.91],
    [side * 1.42, 1.73, -0.82],
    [side * 1.36, 1.02, 0.00],
  ];
  let earFaces = [[0,1,6],[1,2,6],[2,0,6],[3,5,4],[0,3,4],[0,4,1],[0,2,5],[0,5,3],[1,4,5],[1,5,2]];
  if (side < 0) earFaces = earFaces.map(f => f.toReversed());
  const ear = new THREE.Mesh(facetedGeometry(earVertices, earFaces, 0.25), orange);
  ear.material = orange;
  ear.name = side < 0 ? 'Left ear' : 'Right ear';
  mascot.add(ear);
  const inset = new THREE.BufferGeometry();
  const insetPoints = [
    [side * 1.67, 0.73, -0.027],
    [side * 1.39, 1.58, -0.65],
    [side * 1.13, 1.08, -0.073],
  ];
  if (side < 0) insetPoints.reverse();
  inset.setAttribute('position', new THREE.Float32BufferAttribute(insetPoints.flat(), 3));
  inset.computeVertexNormals();
  const inner = new THREE.Mesh(inset, matte(0xb53b20, { side: THREE.DoubleSide, flatShading: true }));
  inner.name = 'Warm inner ear';
  mascot.add(inner);
}
addEar(-1);
addEar(1);

// Attach the eye and spot surfaces to the actual head triangles.
const surfaceTriangles = faces.flatMap(face => {
  const [a, b, c] = face.map(index => vertices[index]);
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 0.00001) return [];
  return [{ a, b, c, denominator, minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]), minY: Math.min(a[1], b[1], c[1]), maxY: Math.max(a[1], b[1], c[1]) }];
});
// Barycentric sampling is allocation-free, including during pupil animation.
function surfaceZ(x, y) {
  let z = -Infinity;
  for (const { a, b, c, denominator, minX, maxX, minY, maxY } of surfaceTriangles) {
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
    const w = 1 - u - v;
    if (u >= -0.00001 && v >= -0.00001 && w >= -0.00001) z = Math.max(z, u * a[2] + v * b[2] + w * c[2]);
  }
  return Number.isFinite(z) ? z : 0.8;
}

const yellow = matte(0xe7c342, { side: THREE.DoubleSide, vertexColors: true, flatShading: false });
const charcoal = new THREE.MeshBasicMaterial({ color: 0x252823, side: THREE.DoubleSide, toneMapped: false });

// Clockwise convex outline gives the half-lidded shape in the reference.
const eyeOutline = [
  [-0.82, 0.15], [-0.38, 0.34], [0.10, 0.39], [0.74, 0.18],
  [0.79, -0.13], [0.47, -0.39], [0.02, -0.49], [-0.44, -0.36], [-0.72, -0.12],
];

function eyePoint(eye, x, y, lift = 0) {
  const px = eye.x + x;
  const py = eye.y + y;
  const bulge = Math.max(0, 1 - (x / 0.95) ** 2 - (y / 0.69) ** 2) * 0.125;
  return [px, py, surfaceZ(px, py) + 0.021 + bulge + lift];
}

function eyeGeometry(eye) {
  const positions = [], colors = [];
  const center = [0, -0.05];
  // Subdivided triangles follow the surface while keeping the perimeter polygonal.
  function triangle(a, b, c, depth) {
    if (depth) {
      const ab = a.map((v, i) => (v + b[i]) / 2);
      const ac = a.map((v, i) => (v + c[i]) / 2);
      const bc = b.map((v, i) => (v + c[i]) / 2);
      triangle(a, ab, ac, depth - 1);
      triangle(ab, b, bc, depth - 1);
      triangle(ac, bc, c, depth - 1);
      triangle(ab, bc, ac, depth - 1);
      return;
    }
    for (const point of [a, c, b]) {
      positions.push(...eyePoint(eye, ...point));
      const tint = 0.94 + (point[1] + 0.49) * 0.07;
      colors.push(tint, tint, tint);
    }
  }
  eyeOutline.forEach((point, i) => triangle(center, point, eyeOutline[(i + 1) % eyeOutline.length], 2));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Geometric clipping keeps pupils under the eyelids, even at the gaze extremes.
function clipPolygon(subject, clip) {
  let output = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    const distance = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    let previous = input.at(-1), previousD = distance(previous);
    for (const current of input) {
      const currentD = distance(current);
      if ((currentD <= 0) !== (previousD <= 0)) {
        const t = previousD / (previousD - currentD);
        output.push([previous[0] + (current[0] - previous[0]) * t, previous[1] + (current[1] - previous[1]) * t]);
      }
      if (currentD <= 0) output.push(current);
      previous = current;
      previousD = currentD;
    }
  }
  return output;
}


// Project decals into each triangle of the receiving surface. Clipping against
// the real triangles prevents z-fighting and holes at every camera angle.
function projectOverlay(polygon, triangles, lift) {
  const positions = [];
  const minX = Math.min(...polygon.map(p => p[0])), maxX = Math.max(...polygon.map(p => p[0]));
  const minY = Math.min(...polygon.map(p => p[1])), maxY = Math.max(...polygon.map(p => p[1]));
  for (const triangle of triangles) {
    const { a, b, c, denominator } = triangle;
    if (maxX < triangle.minX || minX > triangle.maxX || maxY < triangle.minY || minY > triangle.maxY) continue;
    const clip = (denominator > 0 ? [c, b, a] : [a, b, c]).map(p => [p[0], p[1]]);
    const clipped = clipPolygon(polygon, clip);
    if (clipped.length < 3) continue;
    const position = p => {
      const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / denominator;
      const v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / denominator;
      return [p[0], p[1], u * a[2] + v * b[2] + (1 - u - v) * c[2] + lift];
    };
    for (let i = 1; i < clipped.length - 1; i++) {
      positions.push(...position(clipped[0]), ...position(clipped[i]), ...position(clipped[i + 1]));
    }
  }
  return positions;
}

function geometryTriangles(geometry) {
  const positions = geometry.attributes.position.array;
  const triangles = [];
  for (let i = 0; i < positions.length; i += 9) {
    const a = Array.from(positions.slice(i, i + 3));
    const b = Array.from(positions.slice(i + 3, i + 6));
    const c = Array.from(positions.slice(i + 6, i + 9));
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 0.0000001) continue;
    triangles.push({ a, b, c, denominator, minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]), minY: Math.min(a[1], b[1], c[1]), maxY: Math.max(a[1], b[1], c[1]) });
  }
  return triangles;
}

const eyes = [];
for (const x of [-0.91, 0.91]) {
  const eye = { x, y: -0.075, gaze: new THREE.Vector2(), target: new THREE.Vector2() };
  eye.mesh = new THREE.Mesh(eyeGeometry(eye), yellow);
  eye.triangles = geometryTriangles(eye.mesh.geometry);
  eye.mesh.name = x < 0 ? 'Left golden eye' : 'Right golden eye';
  mascot.add(eye.mesh);
  eye.pupilGeometry = new THREE.BufferGeometry();
  // Fixed buffers are reused; no per-frame geometry allocation or disposal.
  eye.positions = new Float32Array(64 * 16 * 3 * 3);
  eye.pupilGeometry.setAttribute('position', new THREE.BufferAttribute(eye.positions, 3).setUsage(THREE.DynamicDrawUsage));
  eye.pupilGeometry.setDrawRange(0, 0);
  eye.pupil = new THREE.Mesh(eye.pupilGeometry, charcoal);
  eye.pupil.frustumCulled = false;
  eye.pupil.name = x < 0 ? 'Left tracking pupil' : 'Right tracking pupil';
  mascot.add(eye.pupil);
  eyes.push(eye);
}

function updatePupil(eye) {
  const outline = [];
  const cx = eye.x + eye.gaze.x;
  const cy = eye.y + 0.19 + eye.gaze.y;
  for (let i = 0; i < 28; i++) {
    const angle = i / 28 * Math.PI * 2;
    outline.push([cx + Math.cos(angle) * 0.285, cy + Math.sin(angle) * 0.405]);
  }
  const positions = projectOverlay(outline, eye.triangles, 0.004);
  eye.positions.set(positions);
  eye.pupilGeometry.setDrawRange(0, positions.length / 3);
  eye.pupilGeometry.attributes.position.needsUpdate = true;
}
eyes.forEach(updatePupil);

function addSpot(x, y, rx, ry, angle) {
  const outline = [];
  for (let i = 0; i < 24; i++) {
    const theta = i / 24 * Math.PI * 2;
    const dx = Math.cos(theta) * rx, dy = Math.sin(theta) * ry;
    outline.push([x + dx * Math.cos(angle) - dy * Math.sin(angle), y + dx * Math.sin(angle) + dy * Math.cos(angle)]);
  }
  const positions = projectOverlay(outline, surfaceTriangles.filter(t => t.denominator > 0), 0.006);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const spot = new THREE.Mesh(geometry, charcoal);
  spot.name = 'Forehead marking';
  mascot.add(spot);
}
addSpot(-0.68, 0.79, 0.31, 0.115, -0.22);
addSpot(-0.08, 0.96, 0.15, 0.115, -0.12);
addSpot(0.57, 0.85, 0.25, 0.135, 0.49);
addSpot(0.24, 0.57, 0.16, 0.12, -0.13);

// A ray through the pointer finds a target in front of the model. Each eye
// tracks it in model coordinates, so looking continues to work after rotation.
const pointer = new THREE.Vector2();
let pointerActive = false;
const pointerRay = new THREE.Raycaster();
const targetPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1);
const targetWorld = new THREE.Vector3();
const targetLocal = new THREE.Vector3();
const drag = { active: false, x: 0, y: 0, yaw: 0.52, pitch: 0.12 };
let targetYaw = drag.yaw, targetPitch = drag.pitch;

function setPointer(event) {
  pointer.set(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2);
  pointerActive = true;
}
window.addEventListener('pointermove', event => {
  setPointer(event);
  if (drag.active) {
    targetYaw = drag.yaw + (event.clientX - drag.x) * 0.006;
    targetPitch = THREE.MathUtils.clamp(drag.pitch + (event.clientY - drag.y) * 0.005, -0.65, 0.65);
  }
}, { passive: true });
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  setPointer(event);
  Object.assign(drag, { active: true, x: event.clientX, y: event.clientY, yaw: targetYaw, pitch: targetPitch });
  canvas.setPointerCapture(event.pointerId);
});
function endDrag() { drag.active = false; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);
document.documentElement.addEventListener('pointerleave', () => { if (!drag.active) pointerActive = false; });
window.addEventListener('blur', () => { pointerActive = false; endDrag(); });
canvas.addEventListener('dblclick', () => { targetYaw = 0.52; targetPitch = 0.12; });

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.position.z = camera.aspect < 1 ? 8.2 / camera.aspect : 10.6;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
window.addEventListener('resize', resize, { passive: true });
resize();

let previousTime = 0;
function render(time) {
  const dt = Math.min((time - previousTime) / 1000 || 1 / 60, 0.05);
  previousTime = time;
  const ease = 1 - Math.exp(-dt * 11);
  mascot.rotation.y = THREE.MathUtils.lerp(mascot.rotation.y, targetYaw, ease);
  mascot.rotation.x = THREE.MathUtils.lerp(mascot.rotation.x, targetPitch, ease);
  mascot.updateMatrixWorld(true);
  if (pointerActive) {
    pointerRay.setFromCamera(pointer, camera);
    pointerRay.ray.intersectPlane(targetPlane, targetWorld);
    targetLocal.copy(targetWorld);
    mascot.worldToLocal(targetLocal);
  }
  for (const eye of eyes) {
    if (pointerActive) {
      const dx = targetLocal.x - eye.x;
      const dy = targetLocal.y - eye.y;
      // The bounded offset preserves the sleepy expression without escaping lids.
      eye.target.set(Math.tanh(dx * 0.42) * 0.31, Math.tanh(dy * 0.46) * 0.19);
    } else eye.target.set(0, 0);
    if (eye.gaze.distanceToSquared(eye.target) > 0.0000001) {
      eye.gaze.lerp(eye.target, ease);
      updatePupil(eye);
    }
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(render);

// Read-only diagnostics are useful for verifying the scene without adding UI.
window.__mascot = {
  scene, camera, renderer, model: mascot, eyes,
  get ready() { return renderer.info.render.triangles > 0; },
};
