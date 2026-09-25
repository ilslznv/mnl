import * as THREE from 'three';

const WIDTH = 382, HEIGHT = 311;
const lightDirection = new THREE.Vector3(-0.35, 0.8, 0.75).normalize();
const toLinear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const toSrgb = value => 255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055);
const lighting = normal => 0.36 + 0.64 * Math.max(0, normal.dot(lightDirection));

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

  // This rectangle lies entirely inside one orange forehead facet. Keep its
  // original, low-frequency paint mottling, rather than extracting fine noise.
  const patch = { x: 160, y: 118, width: 72, height: 33 };
  const patchMean = [0, 0, 0];
  for (let y = 0; y < patch.height; y++) for (let x = 0; x < patch.width; x++) {
    sample(patch.x + x, patch.y + y).forEach((c, i) => patchMean[i] += c / (patch.width * patch.height));
  }
  // Quilt overlapping 20-pixel pieces of the actual pigment. Offsets vary
  // deterministically, so no mirrored motifs or repeated rectangular tiles appear.
  const quiltSize = 384, quilt = new Float32Array(quiltSize * quiltSize * 3);
  const accumulated = new Float32Array(quiltSize * quiltSize);
  const hash = (x, y, seed) => {
    let n = Math.imul(x + 19, 374761393) ^ Math.imul(y + 41, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n ^ (n >>> 16)) >>> 0;
  };
  const pieceSize = 20, stride = 10;
  for (let by = -1; by <= Math.ceil(quiltSize / stride); by++) for (let bx = -1; bx <= Math.ceil(quiltSize / stride); bx++) {
    const sx = hash(bx, by, 19) % (patch.width - pieceSize);
    const sy = hash(bx, by, 127) % (patch.height - pieceSize);
    const turn = hash(bx, by, 337) % 4;
    for (let iy = 0; iy < pieceSize; iy++) for (let ix = 0; ix < pieceSize; ix++) {
      const x = bx * stride + ix, y = by * stride + iy;
      if (x < 0 || y < 0 || x >= quiltSize || y >= quiltSize) continue;
      const w = Math.sin(Math.PI * (ix + 0.5) / pieceSize) ** 2 * Math.sin(Math.PI * (iy + 0.5) / pieceSize) ** 2;
      const [u, v] = turn === 0 ? [ix, iy] : turn === 1 ? [iy, pieceSize - 1 - ix]
        : turn === 2 ? [pieceSize - 1 - ix, pieceSize - 1 - iy] : [pieceSize - 1 - iy, ix];
      const color = sample(patch.x + sx + u, patch.y + sy + v), id = y * quiltSize + x;
      accumulated[id] += w;
      color.forEach((c, i) => quilt[id * 3 + i] += c / patchMean[i] * w);
    }
  }
  for (let id = 0; id < accumulated.length; id++) for (let i = 0; i < 3; i++) quilt[id * 3 + i] = 1 + (quilt[id * 3 + i] / accumulated[id] - 1) * 1.10;
  function paint(u, v) {
    // All model coordinates fit inside this atlas; wrapping is only padding.
    const x = ((u + 192) % quiltSize + quiltSize) % quiltSize;
    const y = ((v + 192) % quiltSize + quiltSize) % quiltSize;
    const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
    const indices = [iy * quiltSize + ix, iy * quiltSize + (ix + 1) % quiltSize,
      ((iy + 1) % quiltSize) * quiltSize + ix, ((iy + 1) % quiltSize) * quiltSize + (ix + 1) % quiltSize];
    return [0, 1, 2].map(i => (quilt[indices[0] * 3 + i] * (1 - tx) + quilt[indices[1] * 3 + i] * tx) * (1 - ty)
      + (quilt[indices[2] * 3 + i] * (1 - tx) + quilt[indices[3] * 3 + i] * tx) * ty);
  }

  function surfaceDetail(p, normal) {
    const w = [Math.abs(normal.x) ** 4, Math.abs(normal.y) ** 4, Math.abs(normal.z) ** 4];
    const sum = w[0] + w[1] + w[2];
    const yz = paint(p.z * 100 + 11, -p.y * 100 + 37);
    const xz = paint(p.x * 100 + 27, p.z * 100 - 17);
    const xy = paint(p.x * 100 + 9, -p.y * 100 + 23);
    return xy.map((_, i) => (yz[i] * w[0] + xz[i] * w[1] + xy[i] * w[2]) / sum);
  }

  function makeSkinSurface(points, boundaryCount, triangles, frontPoints, frontTriangles) {
    const vertices = points.map(p => new THREE.Vector3(...worldPoint(p)));
    const frontNormals = frontTriangles.map(face => normalOf(frontPoints, face, worldPoint));
    const boundaries = points.slice(0, boundaryCount).map((point, index) => {
      const next = (index + 1) % boundaryCount;
      const frontFace = frontTriangles.findIndex(face => face.includes(index) && face.includes(next));
      const a = vertices[index], b = vertices[next], delta = b.clone().sub(a);
      return { a, b, delta, lengthSquared: delta.lengthSq(), point, next: points[next], correction: 1 / lighting(frontNormals[frontFace]) };
    });
    const base = sampleOrange(150, 132).map(c => c / 0.94);
    const texelsPerUnit = 100, padding = 3, atlasWidth = 1024;
    let shelfX = 0, shelfY = 0, shelfHeight = 0;
    const charts = triangles.map(face => {
      const [a, b, c] = face.map(id => vertices[id]);
      const ab = b.clone().sub(a), ac = c.clone().sub(a);
      const axisU = ab.clone().normalize();
      const normal = ab.clone().cross(ac).normalize();
      const axisV = normal.clone().cross(axisU);
      const bx = ab.length() * texelsPerUnit, cx = ac.dot(axisU) * texelsPerUnit, cy = ac.dot(axisV) * texelsPerUnit;
      const minX = Math.min(0, cx), minY = Math.min(0, cy);
      const width = Math.ceil(Math.max(0, bx, cx) - minX) + padding * 2 + 1;
      const height = Math.ceil(Math.max(0, cy) - minY) + padding * 2 + 1;
      if (shelfX + width > atlasWidth) { shelfX = 0; shelfY += shelfHeight; shelfHeight = 0; }
      const chart = { a, axisU, axisV, normal, bx, cx, cy, minX, minY, width, height, x: shelfX, y: shelfY };
      shelfX += width; shelfHeight = Math.max(shelfHeight, height);
      return chart;
    });
    const atlasHeight = shelfY + shelfHeight;
    const output = new Uint8ClampedArray(atlasWidth * atlasHeight * 4);
    const geometry = frontGeometry(points, triangles);
    const uv = geometry.attributes.uv;
    charts.forEach((chart, faceIndex) => {
      const { a, axisU, axisV, bx, cx, cy, minX, minY } = chart;
      [[0, 0], [bx, 0], [cx, cy]].forEach(([u, v], corner) => {
        uv.setXY(faceIndex * 3 + corner, (chart.x + padding + u - minX + 0.5) / atlasWidth,
          1 - (chart.y + padding + v - minY + 0.5) / atlasHeight);
      });
      for (let py = 0; py < chart.height; py++) for (let px = 0; px < chart.width; px++) {
        const u = (px - padding + minX) / texelsPerUnit, v = (py - padding + minY) / texelsPerUnit;
        const p = a.clone().addScaledVector(axisU, u).addScaledVector(axisV, v);
        const detail = surfaceDetail(p, chart.normal);
        let closest = null, distanceSquared = Infinity;
        for (const edge of boundaries) {
          const t = THREE.MathUtils.clamp(p.clone().sub(edge.a).dot(edge.delta) / edge.lengthSquared, 0, 1);
          const d = p.distanceToSquared(edge.a.clone().addScaledVector(edge.delta, t));
          if (d < distanceSquared) { closest = { edge, t }; distanceSquared = d; }
        }
        const blend = THREE.MathUtils.smoothstep(Math.sqrt(distanceSquared), 0.015, 0.78);
        let edgeColor = base;
        if (blend < 1) {
          const { edge, t } = closest;
          const x = edge.point[0] * (1 - t) + edge.next[0] * t;
          const y = edge.point[1] * (1 - t) + edge.next[1] * t;
          const dx = 183 - x, dy = 179 - y, length = Math.hypot(dx, dy);
          edgeColor = sampleOrange(x + dx / length * 1.2, y + dy / length * 1.2).map(c => c * edge.correction);
        }
        const offset = ((chart.y + py) * atlasWidth + chart.x + px) * 4;
        for (let channel = 0; channel < 3; channel++) {
          output[offset + channel] = toSrgb((base[channel] * blend + edgeColor[channel] * (1 - blend)) * detail[channel]);
        }
        output[offset + 3] = 255;
      }
    });
    const texture = new THREE.DataTexture(output, atlasWidth, atlasHeight, THREE.RGBAFormat);
    texture.flipY = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    geometry.userData.texelsPerUnit = texelsPerUnit;
    return { texture, geometry };
  }

  function skinMaterial(map) {
    const material = new THREE.MeshBasicMaterial({ map, side: THREE.FrontSide, toneMapped: false });
    material.name = 'Continuous reference pigment';
    material.userData.surfaceRole = 'skin';
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec3 vCurrentNormal;
      `);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vCurrentNormal = mat3(modelMatrix) * normal;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vCurrentNormal;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec3 keyDirection = normalize(vec3(-0.35, 0.8, 0.75));
        float currentLight = 0.36 + 0.64 * max(dot(normalize(vCurrentNormal), keyDirection), 0.0);
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
    let rearTriangles;
    if (ear) {
      rearPoints.push([...center, name === 'Upper ear' ? -0.45 : -0.79]);
      rearTriangles = triangulate(rearPoints, boundaryCount).map(face => face.toReversed());
    } else {
      // Deliberate crown, temple and lower bevel loops continue the front's
      // broad planes. The central back is a low ridge, not a radial fan.
      rearPoints.push(...[
        [72, 135], [152, 101], [267, 113], [326, 171],
        [301, 233], [209, 266], [79, 251], [45, 193],
        [147, 185], [247, 186],
      ].map(([x, y]) => [x, y, plane([x, y]) - 1.12 * Math.sqrt(1 - radialFraction([x, y], boundary, [183, 179]) ** 2)]));
      const panels = [
        [0, 1, 14], [1, 2, 15, 14], [2, 3, 4, 16, 15], [4, 5, 16],
        [5, 6, 17, 16], [6, 7, 17], [7, 8, 18, 17], [8, 9, 19, 18],
        [9, 10, 19], [10, 11, 20, 19], [11, 12, 20], [12, 13, 21, 20],
        [13, 0, 14, 21], [14, 15, 22, 21], [15, 16, 23, 22],
        [16, 17, 23], [17, 18, 23], [18, 19, 22, 23], [19, 20, 21, 22],
      ];
      rearTriangles = panels.flatMap(panel => THREE.ShapeUtils.triangulateShape(panel.map(id => new THREE.Vector2(rearPoints[id][0], rearPoints[id][1])), [])
        .map(face => face.map(local => panel[local]))).map(face => {
          const [a, b, c] = face.map(id => rearPoints[id]);
          return ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 0 ? face : face.toReversed();
        });
    }
    // A shape-aware edge flip makes the rear convex in 3D. Screen-space
    // Delaunay alone can introduce inward folds between otherwise sound vertices.
    if (!ear) for (let pass = 0; pass < 100; pass++) {
      const edges = new Map();
      rearTriangles.forEach((face, id) => face.forEach((a, i) => {
        const b = face[(i + 1) % 3], c = face[(i + 2) % 3], key = [a, b].sort((a, b) => a - b).join(':');
        if (!edges.has(key)) edges.set(key, []);
        edges.get(key).push({ a, b, c, id });
      }));
      let changed = false;
      const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      for (const pair of edges.values()) {
        if (pair.length !== 2) continue;
        const { a, b, c, id } = pair[0], d = pair[1].c;
        if (cross(rearPoints[c], rearPoints[d], rearPoints[a]) * cross(rearPoints[c], rearPoints[d], rearPoints[b]) >= -0.00001) continue;
        const n = normalOf(rearPoints, rearTriangles[id], worldPoint);
        const delta = new THREE.Vector3(...worldPoint(rearPoints[d])).sub(new THREE.Vector3(...worldPoint(rearPoints[a])));
        if (n.dot(delta) <= 0.00001) continue;
        rearTriangles[id] = [c, d, a]; rearTriangles[pair[1].id] = [d, c, b];
        for (const faceId of [id, pair[1].id]) {
          const face = rearTriangles[faceId];
          if (cross(...face.map(i => rearPoints[i])) < 0) face.reverse();
        }
        changed = true; break;
      }
      if (!changed) break;
    }
    const surface = makeSkinSurface(rearPoints, boundaryCount, rearTriangles, points, frontTriangles);
    const back = new THREE.Mesh(surface.geometry, skinMaterial(surface.texture));
    back.name = name + ' — continuous sculpted back';

    model.add(back);
    return { front, back, points, triangles: frontTriangles, rearPoints, rearTriangles, boundaryCount };
  };
}
