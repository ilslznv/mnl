import * as THREE from 'three';

const WIDTH = 382, HEIGHT = 311;
const lightDirection = new THREE.Vector3(-0.35, 0.8, 0.75).normalize();
const toLinear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const toSrgb = value => 255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055);
const lighting = normal => 0.55 + 0.45 * Math.max(0, normal.dot(lightDirection));

function normalOf(points, face, worldPoint) {
  const [a, b, c] = face.map(id => new THREE.Vector3(...worldPoint(points[id])));
  return b.sub(a).cross(c.sub(a)).normalize();
}

function radialFraction(point, boundary, center) {
  let result = 0;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const atCenter = side(center);
    if (Math.abs(atCenter) > 0.0001) result = Math.max(result, 1 - side(point) / atCenter);
  }
  return THREE.MathUtils.clamp(result, 0, 1);
}

function closestBoundary(point, boundary) {
  let best = { distance: Infinity };
  boundary.forEach((a, index) => {
    const b = boundary[(index + 1) % boundary.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = THREE.MathUtils.clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    const x = a[0] + t * dx, y = a[1] + t * dy;
    const distance = Math.hypot(point[0] - x, point[1] - y);
    if (distance < best.distance) best = { distance, x, y, edge: index };
  });
  return best;
}

export function createVolumeBuilder({ original, triangulate, worldPoint, frontGeometry, referenceMaterial, model }) {
  const data = original.data;
  const sample = (x, y) => {
    x = THREE.MathUtils.clamp(Math.round(x), 0, WIDTH - 1);
    y = THREE.MathUtils.clamp(Math.round(y), 0, HEIGHT - 1);
    const index = (y * WIDTH + x) * 4;
    return [data[index], data[index + 1], data[index + 2]].map(channel => toLinear(channel / 255));
  };

  // Propagate valid orange pigment into transparent/eye pixels for clean seams.
  const nearestOrange = new Int32Array(WIDTH * HEIGHT).fill(-1);
  const queue = new Int32Array(WIDTH * HEIGHT);
  let start = 0, end = 0;
  for (let pixel = 0; pixel < nearestOrange.length; pixel++) {
    const i = pixel * 4;
    if (data[i + 3] > 240 && data[i] > 95 && data[i] > data[i + 1] * 1.5 && data[i + 1] > 25) {
      nearestOrange[pixel] = pixel; queue[end++] = pixel;
    }
  }
  while (start < end) {
    const pixel = queue[start++], x = pixel % WIDTH, y = Math.floor(pixel / WIDTH);
    const neighbors = [];
    if (x) neighbors.push(pixel - 1);
    if (x < WIDTH - 1) neighbors.push(pixel + 1);
    if (y) neighbors.push(pixel - WIDTH);
    if (y < HEIGHT - 1) neighbors.push(pixel + WIDTH);
    for (const next of neighbors) {
      if (nearestOrange[next] < 0) { nearestOrange[next] = nearestOrange[pixel]; queue[end++] = next; }
    }
  }
  const paddingData = new Uint8ClampedArray(data.length);
  for (let pixel = 0; pixel < nearestOrange.length; pixel++) {
    const source = nearestOrange[pixel] * 4;
    paddingData.set([data[source], data[source + 1], data[source + 2], 255], pixel * 4);
  }
  const paddingMap = new THREE.DataTexture(paddingData, WIDTH, HEIGHT, THREE.RGBAFormat);
  paddingMap.colorSpace = THREE.SRGBColorSpace;
  paddingMap.flipY = true;
  paddingMap.minFilter = THREE.LinearFilter;
  paddingMap.magFilter = THREE.LinearFilter;
  paddingMap.needsUpdate = true;
  referenceMaterial.userData.edgePadding = paddingMap;

  const sampleOrange = (x, y) => {
    const pixel = THREE.MathUtils.clamp(Math.round(y), 0, HEIGHT - 1) * WIDTH + THREE.MathUtils.clamp(Math.round(x), 0, WIDTH - 1);
    const sum = [0, 0, 0];
    const px = pixel % WIDTH, py = Math.floor(pixel / WIDTH);
    for (let dy = -3; dy <= 3; dy += 3) {
      for (let dx = -3; dx <= 3; dx += 3) {
        const id = THREE.MathUtils.clamp(py + dy, 0, HEIGHT - 1) * WIDTH + THREE.MathUtils.clamp(px + dx, 0, WIDTH - 1);
        const nearest = nearestOrange[id];
        const color = sample(nearest % WIDTH, Math.floor(nearest / WIDTH));
        color.forEach((c, channel) => { sum[channel] += c / 9; });
      }
    }
    return sum;
  };

  // Real pigment detail from an orange-only area of the supplied image. A local
  // mean removes its baked facet illumination without replacing its grain.
  const grainWidth = 92, grainHeight = 100;
  const grain = new Float32Array(grainWidth * grainHeight);
  for (let y = 0; y < grainHeight; y++) {
    for (let x = 0; x < grainWidth; x++) {
      const sx = x + 14, sy = y + 116;
      let mean = 0;
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const index = ((sy + dy) * WIDTH + sx + dx) * 4;
          mean += data[index] * 0.45 + data[index + 1] * 0.45 + data[index + 2] * 0.10;
        }
      }
      mean /= 121;
      const index = (sy * WIDTH + sx) * 4;
      const value = data[index] * 0.45 + data[index + 1] * 0.45 + data[index + 2] * 0.10;
      grain[y * grainWidth + x] = THREE.MathUtils.clamp(value / Math.max(mean, 1), 0.935, 1.065);
    }
  }
  const mirror = (value, size) => {
    const coordinate = ((Math.floor(value) % (size * 2)) + size * 2) % (size * 2);
    return coordinate < size ? coordinate : size * 2 - coordinate - 1;
  };
  function pigment(x, y) {
    const read = (u, v) => grain[mirror(v, grainHeight) * grainWidth + mirror(u, grainWidth)] - 1;
    return 1 + read(x + 13, y + 29) * 0.45
      + read(-y * 1.17 + 31, x * 1.11 + 57) * 0.35
      + read(x * 0.83 + y * 0.47 + 61, y * 0.91 - x * 0.39 + 7) * 0.30;
  }

  function makeSkinTexture(points, boundaryCount, triangles, frontPoints, frontTriangles, center, ear) {
    const boundary = points.slice(0, boundaryCount);
    const resolution = 2;
    const outputWidth = WIDTH * resolution, outputHeight = HEIGHT * resolution;
    const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    const triangleNormals = triangles.map(face => normalOf(points, face, worldPoint));
    const frontNormals = frontTriangles.map(face => normalOf(frontPoints, face, worldPoint));
    const surfaceFaces = triangles.map((face, index) => {
      const [a, b, c] = face.map(id => points[id]);
      const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      return { a, b, c, denominator, normal: triangleNormals[index], minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]), minY: Math.min(a[1], b[1], c[1]), maxY: Math.max(a[1], b[1], c[1]) };
    });
    function surfaceAt(x, y) {
      for (const face of surfaceFaces) {
        if (x < face.minX || x > face.maxX || y < face.minY || y > face.maxY) continue;
        const { a, b, c, denominator } = face;
        const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
        const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
        if (u >= -0.0001 && v >= -0.0001 && u + v <= 1.0001) return { z: u * a[2] + v * b[2] + (1 - u - v) * c[2], normal: face.normal };
      }
      return null;
    }
    const edgeCorrection = boundary.map((_, edge) => {
      const next = (edge + 1) % boundaryCount;
      const frontFace = frontTriangles.findIndex(face => face.includes(edge) && face.includes(next));
      const fn = frontNormals[frontFace];
      return 1 / lighting(fn);
    });

    // The same warm orange pigment progresses from a lighter crown to a darker
    // underside. It is sampled from the reference, not a random face palette.
    const stops = ear
      ? [[0, sample(119, 34)], [100, sample(111, 70)], [311, sample(80, 140)]]
      : [[45, sample(170, 70)], [115, sample(150, 120)], [205, sample(155, 143)], [262, sample(235, 243)], [311, sample(220, 275)]];
    function basePigment(y) {
      let a = stops[0], b = stops.at(-1);
      if (y <= a[0]) return a[1];
      if (y >= b[0]) return b[1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (y >= stops[i][0] && y <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
      }
      const t = THREE.MathUtils.smoothstep(y, a[0], b[0]);
      return a[1].map((c, i) => c + (b[1][i] - c) * t);
    }
    for (let py = 0; py < outputHeight; py++) {
      const y = (py + 0.5) / resolution;
      const base = basePigment(y);
      for (let px = 0; px < outputWidth; px++) {
        const x = (px + 0.5) / resolution;
        const index = (py * outputWidth + px) * 4;
        const surface = surfaceAt(x, y);
        if (!surface) {
          for (let channel = 0; channel < 3; channel++) output[index + channel] = toSrgb(base[channel] / 0.8);
          output[index + 3] = 255;
          continue;
        }
        const closest = closestBoundary([x, y], boundary);
        const distanceToCenter = Math.hypot(center[0] - closest.x, center[1] - closest.y);
        const inward = Math.min(1, 2.2 / distanceToCenter);
        const edgeColor = sampleOrange(closest.x + (center[0] - closest.x) * inward, closest.y + (center[1] - closest.y) * inward);
        const mix = THREE.MathUtils.smoothstep(closest.distance, 0, ear ? 15 : 24);
        const n = surface.normal;
        const weights = [Math.abs(n.x) ** 4, Math.abs(n.y) ** 4, Math.abs(n.z) ** 4];
        const total = weights[0] + weights[1] + weights[2];
        const detail = ((pigment(surface.z * 100 + 19, y) * weights[0]
          + pigment(x, surface.z * 100 + 53) * weights[1]
          + pigment(x, y) * weights[2]) / total) ** 2.2;
        for (let channel = 0; channel < 3; channel++) {
          const boundaryValue = edgeColor[channel] * edgeCorrection[closest.edge];
          const value = boundaryValue * (1 - mix) + base[channel] / 0.80 * detail * mix;
          output[index + channel] = toSrgb(value);
        }
        output[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(output, outputWidth, outputHeight, THREE.RGBAFormat);
    texture.flipY = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  function skinMaterial(map) {
    const material = new THREE.MeshBasicMaterial({ map, side: THREE.FrontSide, toneMapped: false });
    material.name = 'Continuous reference pigment';
    material.userData.surfaceRole = 'skin';
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec3 vReferenceNormal;
        varying vec3 vCurrentNormal;
      `);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vReferenceNormal = vec3(-normal.x, normal.y, -normal.z);
        vCurrentNormal = mat3(modelMatrix) * normal;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vReferenceNormal;
        varying vec3 vCurrentNormal;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec3 keyDirection = normalize(vec3(-0.35, 0.8, 0.75));
        float currentLight = 0.55 + 0.45 * max(dot(normalize(vCurrentNormal), keyDirection), 0.0);
        diffuseColor.rgb *= currentLight;
      `);
    };
    return material;
  }

  return function addVolume(name, points, boundaryCount, center, unusedDepth, ear = false) {
    const boundary = points.slice(0, boundaryCount);
    const plane = point => 0.34 * (point[0] - 183) / 100 + 0.10 * (179 - point[1]) / 100;
    if (!ear) {
      points.forEach((point, i) => {
        const radius = i < boundaryCount ? 1 : radialFraction(point, boundary, [183, 179]);
        point[2] = plane(point) + 1.10 * Math.sqrt(Math.max(0, 1 - radius * radius));
      });
    } else {
      // Thin triangular ears, with a shared sharp tip and no extruded boxes.
      const upper = name === 'Upper ear';
      const depths = upper ? [-0.18, 0.08, -0.12, -0.29, 0.04] : [-0.61, -0.22, -0.29, -0.62, -0.25];
      points.forEach((point, i) => { point[2] = depths[i]; });
    }
    const frontTriangles = triangulate(points, boundaryCount);
    const front = new THREE.Mesh(frontGeometry(points, frontTriangles), referenceMaterial);
    front.name = name + ' — reference facets';
    front.renderOrder = 1;
    model.add(front);

    const rearPoints = points.slice(0, boundaryCount).map(point => point.slice());
    const interior = ear ? [[...center, name === 'Upper ear' ? -0.45 : -0.79]] : [
      [68, 133], [144, 98], [219, 101], [290, 122],
      [33, 199], [105, 186], [181, 165], [250, 171], [338, 190],
      [78, 260], [155, 240], [229, 233], [300, 251], [205, 281],
    ].map(point => {
      const radius = radialFraction(point, boundary, [183, 179]);
      return [...point, plane(point) - 1.08 * Math.sqrt(Math.max(0, 1 - radius * radius))];
    });
    rearPoints.push(...interior);
    const rearTriangles = triangulate(rearPoints, boundaryCount).map(face => face.toReversed());
    const rearTexture = makeSkinTexture(rearPoints, boundaryCount, rearTriangles, points, frontTriangles, ear ? center : [183, 179], ear);
    const back = new THREE.Mesh(frontGeometry(rearPoints, rearTriangles), skinMaterial(rearTexture));
    back.name = name + ' — continuous sculpted back';
    model.add(back);
    return { front, back, points, triangles: frontTriangles, rearPoints, rearTriangles, boundaryCount };
  };
}
