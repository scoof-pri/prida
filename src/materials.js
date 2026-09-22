import * as T from 'three';
import { terrainMesh, biomeAt, TERRAIN_STEP } from './terrain.js';
import { texture, TEXTURES } from './assets.js';
const linear = (rgb) => new T.Vector3(...rgb.map((c) => Math.pow(c / 255, 2.2)));
// Uniforms shared by every animated world shader (wind in leaves and grass, drifting clouds, water).
export const WORLD = {
  time: { value: 0 },
  wind: { value: new T.Vector2(0.8, 0.35) },
  sunDir: { value: new T.Vector3(-0.45, 0.82, 0.44).normalize() },
};
// World-space triplanar PBR surfaces. Every surface samples a CC0 texture set (colour, OpenGL normal map and
// AO/roughness/metal map, see ASSET-CREDITS.md) from world coordinates, so it works on batched and instanced
// geometry with no UVs, and a brick is the same size on every wall.
//   look.albedo  0: the texture only adds detail to the palette colour (painted plaster keeps its paint);
//                1: the texture's own colour (real bricks, asphalt, tiles), lightly tinted by `look.tint`.
//   look.size    metres covered by one repeat of the texture.
//   look.normal  strength of the normal map.   look.metal  how much the texture's metal channel counts.
const LOOKS = {
  bricks: { size: 1.8, albedo: 1, tint: 0.28, normal: 1.15 },
  plaster: { size: 2.4, albedo: 0, tint: 1, normal: 0.8 },
  concrete: { size: 3, albedo: 0.55, tint: 0.7, normal: 0.9 },
  asphalt: { size: 4, albedo: 0.85, tint: 0.3, normal: 1 },
  paving: { size: 2, albedo: 0.8, tint: 0.35, normal: 1.1 },
  sidewalk: { size: 3, albedo: 0.85, tint: 0.3, normal: 1.1 },
  dirt: { size: 3, albedo: 0.9, tint: 0.2, normal: 1 },
  tiles: { size: 2, albedo: 0.85, tint: 0.35, normal: 0.8 },
  wood: { size: 2, albedo: 0.8, tint: 0.45, normal: 0.8 },
  oak: { size: 1.4, albedo: 0.35, tint: 0.8, normal: 0.6 },
  roof: { size: 2.4, albedo: 0.9, tint: 0.3, normal: 1.2 },
  claytiles: { size: 2.2, albedo: 1, tint: 0.25, normal: 1.25 },
  corrugated: { size: 2.2, albedo: 0.5, tint: 0.7, normal: 1.4, metal: 0.6 },
  gravel: { size: 2.6, albedo: 0.9, tint: 0.3, normal: 1 },
  metal: { size: 1, albedo: 0.6, tint: 0.6, normal: 1, metal: 1 },
  bark: { size: 1.5, albedo: 0.95, tint: 0.3, normal: 1.3 },
  pinebark: { size: 1.2, albedo: 0.95, tint: 0.3, normal: 1.3 },
  rock: { size: 3, albedo: 0.9, tint: 0.45, normal: 1.3 },
  fabric: { size: 0.7, albedo: 0, tint: 1, normal: 0.9 },
  panels: { size: 3.6, albedo: 0.55, tint: 0.7, normal: 0.9 },
  grass: { size: 3, albedo: 0.9, tint: 0.3, normal: 1 },
  sand: { size: 4, albedo: 0.9, tint: 0.3, normal: 1 },
};
export const lookOf = (name) => LOOKS[name] || { size: 2, albedo: 0, tint: 1, normal: 0.8 };
// Fast graphics: one texture sample per surface, no normal or AO/roughness maps.
let liteSurfaces = false;
const detailCache = new Map(),
  uvMaterials = [];
export function setSurfaceQuality(lite) {
  if (liteSurfaces === !!lite) return;
  liteSurfaces = !!lite;
  for (const m of detailCache.values()) {
    m.defines ??= {};
    if (liteSurfaces) m.defines.PRIDA_LITE = '';
    else delete m.defines.PRIDA_LITE;
    m.needsUpdate = true;
  }
  for (const m of uvMaterials) applyUvMaps(m);
}
// Vertex colour that gives a UV-mapped surface the same look as detailMaterial(name, color) on the walls.
export function surfaceTint(name, color, out = new T.Color()) {
  const look = lookOf(name),
    c = new T.Color(color),
    mean = TEXTURES[name] ? linear(TEXTURES[name]) : new T.Vector3(0.5, 0.5, 0.5);
  const painted = [c.r / Math.max(mean.x, 0.02), c.g / Math.max(mean.y, 0.02), c.b / Math.max(mean.z, 0.02)],
    natural = [1 + (c.r - 1) * look.tint, 1 + (c.g - 1) * look.tint, 1 + (c.b - 1) * look.tint];
  return out.setRGB(
    painted[0] + (natural[0] - painted[0]) * look.albedo,
    painted[1] + (natural[1] - painted[1]) * look.albedo,
    painted[2] + (natural[2] - painted[2]) * look.albedo,
    T.LinearSRGBColorSpace,
  );
}
function applyUvMaps(m) {
  const name = m.userData.surface,
    full = !liteSurfaces;
  m.map = texture(name) || null;
  m.normalMap = full ? texture(name + '_n') || null : null;
  m.roughnessMap = full ? texture(name + '_arm') || null : null;
  m.aoMap = full ? texture(name + '_arm') || null : null;
  m.metalnessMap = full && lookOf(name).metal ? texture(name + '_arm') || null : null;
  m.needsUpdate = true;
}
// A UV-mapped PBR surface (roofs, parapets, rooftop plant): geometry UVs are in texture repeats, vertex colours
// carry the tint (see surfaceTint). The AO/roughness/metal texture feeds all three maps.
const uvCache = new Map();
export function uvMaterial(name, { roughness = 1, metalness = 0, env = 1 } = {}) {
  const key = [name, roughness, metalness, env].join(':');
  if (uvCache.has(key)) return uvCache.get(key);
  const look = lookOf(name),
    m = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness,
      metalness: look.metal ? Math.max(metalness, 0.6) : metalness,
      envMapIntensity: env,
      aoMapIntensity: 0.8,
    });
  m.userData.surface = name;
  m.normalScale.set(look.normal, look.normal);
  applyUvMaps(m);
  uvMaterials.push(m);
  uvCache.set(key, m);
  return m;
}
export const surfacesLite = () => liteSurfaces;
// Shared GLSL: triplanar weights and samples.
const TRIPLANAR = `
  vec3 triBlend(vec3 n){vec3 b=pow(abs(n),vec3(4.0));return b/(b.x+b.y+b.z);}
  vec3 triSample(sampler2D t,vec3 p,vec3 b){return texture2D(t,p.zy).rgb*b.x+texture2D(t,p.xz).rgb*b.y+texture2D(t,p.xy).rgb*b.z;}`;
// `box`: the geometry is made of axis-aligned faces (walls, slabs, crates): one projection per face instead of
// three blended ones, a third of the texture reads.
// `interior`: wall panels carry an instanced `aOut` (outward direction): faces toward the inside of the building
// are painted plaster instead of the facade finish.
export function detailMaterial(name, color, { strength = 0.6, roughness = 0.9, key = '', ceiling = false, box = false, metalness, env = 1, albedo, interior = false } = {}) {
  const id = [name, color, strength, roughness, key, ceiling, box, metalness, env, albedo, interior].join(':');
  if (detailCache.has(id)) return detailCache.get(id);
  const map = texture(name),
    normalMap = texture(name + '_n'),
    armMap = texture(name + '_arm'),
    look = LOOKS[name] || { size: 2, albedo: 0, tint: 1, normal: 0.8 },
    material = new T.MeshStandardMaterial({ color, roughness, metalness: metalness ?? (look.metal ? 0.5 : 0), envMapIntensity: env });
  material.defines = box ? { DETAIL_BOX: '' } : {};
  if (interior) material.defines.DETAIL_INTERIOR = '';
  if (liteSurfaces) material.defines.PRIDA_LITE = '';
  if (map) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms ??= {};
      Object.assign(shader.uniforms, {
        detailMap: { value: map },
        detailNormal: { value: normalMap || map },
        detailArm: { value: armMap || map },
        detailMean: { value: linear(TEXTURES[name]) },
        detailScale: { value: 1 / look.size },
        detailStrength: { value: Math.max(strength, 0.85) },
        detailAlbedo: { value: albedo ?? look.albedo },
        detailTint: { value: look.tint },
        detailNormalScale: { value: normalMap ? look.normal : 0 },
        detailRough: { value: armMap ? 1 : 0 },
        detailMetal: { value: armMap ? look.metal || 0 : 0 },
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vDetailPos;
          varying vec3 vDetailNormal;
          #ifdef DETAIL_INTERIOR
            attribute vec3 aOut;
            varying vec3 vOut;
          #endif`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          #ifdef DETAIL_INTERIOR
            vOut = aOut;
          #endif
          vec4 detailWorld = vec4(transformed, 1.0);
          vec3 detailN = objectNormal;
          #ifdef USE_INSTANCING
            detailWorld = instanceMatrix * detailWorld;
            detailN = mat3(instanceMatrix) * detailN;
          #endif
          vDetailPos = (modelMatrix * detailWorld).xyz;
          vDetailNormal = normalize(mat3(modelMatrix) * detailN);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D detailMap;uniform sampler2D detailNormal;uniform sampler2D detailArm;
          uniform vec3 detailMean;uniform float detailScale;uniform float detailStrength;uniform float detailAlbedo;
          uniform float detailTint;uniform float detailNormalScale;uniform float detailRough;uniform float detailMetal;
          varying vec3 vDetailPos;varying vec3 vDetailNormal;
          #ifdef DETAIL_INTERIOR
            varying vec3 vOut;
          #endif
          ${TRIPLANAR}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 dWN = normalize(vDetailNormal);
          vec3 dP = vDetailPos * detailScale;
          #ifdef DETAIL_BOX
            vec3 dAbs = abs(dWN);
            vec2 dUV; vec3 dT; vec3 dBt; vec3 dN;
            if (dAbs.x >= dAbs.y && dAbs.x >= dAbs.z) { dUV = dP.zy; dT = vec3(0.0, 0.0, 1.0); dBt = vec3(0.0, 1.0, 0.0); dN = vec3(sign(dWN.x), 0.0, 0.0); }
            else if (dAbs.y >= dAbs.z) { dUV = dP.xz; dT = vec3(1.0, 0.0, 0.0); dBt = vec3(0.0, 0.0, 1.0); dN = vec3(0.0, sign(dWN.y), 0.0); }
            else { dUV = dP.xy; dT = vec3(1.0, 0.0, 0.0); dBt = vec3(0.0, 1.0, 0.0); dN = vec3(0.0, 0.0, sign(dWN.z)); }
            vec3 dt = texture2D(detailMap, dUV).rgb;
            #ifdef PRIDA_LITE
              vec3 dArm = vec3(1.0); float dArmMix = 0.0;
            #else
              vec3 dArm = texture2D(detailArm, dUV).rgb; float dArmMix = detailRough;
            #endif
          #else
            vec3 dB = triBlend(dWN);
            #ifdef PRIDA_LITE
              vec3 dAbs = abs(dWN);
              vec2 dUV = dAbs.x >= dAbs.y && dAbs.x >= dAbs.z ? dP.zy : dAbs.y >= dAbs.z ? dP.xz : dP.xy;
              vec3 dt = texture2D(detailMap, dUV).rgb;
              vec3 dArm = vec3(1.0); float dArmMix = 0.0;
            #else
              vec3 dt = triSample(detailMap, dP, dB);
              vec3 dArm = triSample(detailArm, dP, dB); float dArmMix = detailRough;
            #endif
          #endif
          vec3 tintColor = diffuseColor.rgb;
          // Painted: the palette colour with the texture's grain. Natural: the texture's own colour, lightly tinted.
          vec3 painted = tintColor * mix(vec3(1.0), clamp(dt / detailMean, 0.0, 2.2), detailStrength);
          vec3 natural = dt * mix(vec3(1.0), tintColor, detailTint);
          diffuseColor.rgb = mix(painted, natural, detailAlbedo);
          // Cavity occlusion darkens mortar joints and cracks a little even in direct sun.
          float dAO = mix(1.0, dArm.r, dArmMix);
          diffuseColor.rgb *= mix(1.0, dAO, 0.35);
          float dInner = 0.0;
          #if defined( DETAIL_INTERIOR ) && defined( DETAIL_BOX )
            // Inside faces of outer walls: smooth painted plaster, lighter where the facade is dark.
            dInner = step(0.5, -dot(dN, vOut));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.79, 0.76, 0.70) * (0.97 + 0.03 * sin(dot(vDetailPos, vec3(1.3, 0.7, 1.1)))), dInner);
            dAO = mix(dAO, 1.0, dInner);
            dArmMix *= 1.0 - dInner;
          #endif
          ${ceiling ? `float ceilingFace = (1.0 - smoothstep(-0.8, -0.4, dWN.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.76, 0.72), ceilingFace * 0.75);` : ''}`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, clamp(dArm.g * 1.05, 0.06, 1.0), dArmMix);`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, dArm.b, detailMetal * dArmMix);`,
        )
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
          reflectedLight.indirectDiffuse *= dAO;
          reflectedLight.indirectSpecular *= mix(1.0, dAO, 0.7);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          #ifndef PRIDA_LITE
          if (detailNormalScale > 0.0) {
            #ifdef DETAIL_BOX
              vec3 nt = texture2D(detailNormal, dUV).xyz * 2.0 - 1.0;
              nt.xy *= detailNormalScale * (1.0 - dInner);
              vec3 worldN = normalize(dT * nt.x + dBt * nt.y + dN * max(nt.z, 0.05));
            #else
              // Triplanar normal mapping with a whiteout blend (after Ben Golus), done in world space.
              vec3 nX = texture2D(detailNormal, dP.zy).xyz * 2.0 - 1.0;
              vec3 nY = texture2D(detailNormal, dP.xz).xyz * 2.0 - 1.0;
              vec3 nZ = texture2D(detailNormal, dP.xy).xyz * 2.0 - 1.0;
              nX.xy *= detailNormalScale; nY.xy *= detailNormalScale; nZ.xy *= detailNormalScale;
              nX = vec3(nX.xy + dWN.zy, abs(nX.z) * dWN.x);
              nY = vec3(nY.xy + dWN.xz, abs(nY.z) * dWN.y);
              nZ = vec3(nZ.xy + dWN.xy, abs(nZ.z) * dWN.z);
              vec3 worldN = normalize(nX.zyx * dB.x + nY.xzy * dB.y + nZ.xyz * dB.z);
            #endif
            normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz) * faceDirection;
          }
          #endif`,
        );
      // Ceilings face away from sun and sky: a soft bounce keeps rooms from reading as a black lid.
      if (ceiling)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.26 * (1.0 - smoothstep(-0.8, -0.4, normalize(vDetailNormal).y));',
        );
    };
    // The shader source only depends on these flags (the texture set is a uniform): every surface shares it.
    material.customProgramCacheKey = () => 'pbr' + (ceiling ? ':ceiling' : '');
  }
  detailCache.set(id, material);
  return material;
}
// Grassy biomes (3D grass grows there) and the ground colour of every biome.
export const GRASSY = new Set(['city', 'park', 'grove', 'hill', 'forest', 'lake', 'glade', 'meadow']);
export const BIOME_COLORS = {
  city: 0x9fa78b,
  park: 0x75a26f,
  grove: 0x6b8960,
  quarry: 0xc3ac86,
  hill: 0x7f9d68,
  forest: 0x5d7d52,
  lake: 0x7fa06a,
  desert: 0xdcc18c,
  glade: 0x8fb86c,
  meadow: 0x9cbc68,
};
export function makeGround(map) {
  const { vertices, indices } = terrainMesh(map),
    colors = new Float32Array(vertices.length);
  const c = new T.Color();
  for (let i = 0; i < vertices.length; i += 3) {
    c.setHex(BIOME_COLORS[biomeAt(vertices[i], vertices[i + 2], map)]);
    const variation = 0.96 + 0.05 * Math.sin(vertices[i] * 0.31 + vertices[i + 2] * 0.23);
    colors[i] = c.r * variation;
    colors[i + 1] = c.g * variation;
    colors[i + 2] = c.b * variation;
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.setIndex(new T.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  // Sandy weight per vertex: quarry floor and rim use the sand texture, everything else grass.
  const sandy = new Float32Array(vertices.length / 3);
  for (let i = 0; i < sandy.length; i++) {
    const b = biomeAt(vertices[i * 3], vertices[i * 3 + 2], map);
    sandy[i] = b === 'quarry' || b === 'desert' ? 1 : b === 'lake' && vertices[i * 3 + 1] < -0.1 ? 1 : 0;
    // Lake shallows and bed read as wet sand.
    if (b === 'lake' && vertices[i * 3 + 1] < -0.1) {
      colors[i * 3] = 0.34;
      colors[i * 3 + 1] = 0.3;
      colors[i * 3 + 2] = 0.18;
    }
  }
  geometry.setAttribute('sandy', new T.BufferAttribute(sandy, 1));
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 });
  const tex = (n) => texture(n);
  material.onBeforeCompile = (shader) => {
    shader.uniforms ??= {};
    Object.assign(shader.uniforms, {
      grassMap: { value: tex('grass') },
      grassN: { value: tex('grass_n') || tex('grass') },
      grassArm: { value: tex('grass_arm') || tex('grass') },
      sandMap: { value: tex('sand') },
      sandN: { value: tex('sand_n') || tex('sand') },
      dirtMap: { value: tex('dirt') },
      grassMean: { value: linear(TEXTURES.grass) },
      sandMean: { value: linear(TEXTURES.sand) },
      hasNormals: { value: tex('grass_n') && !liteSurfaces ? 1 : 0 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;attribute float sandy;varying float vSandy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSandy=sandy;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvTerrainWorld=(modelMatrix*vec4(transformed,1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerrainWorld;varying float vSandy;
        uniform sampler2D grassMap;uniform sampler2D grassN;uniform sampler2D grassArm;uniform sampler2D sandMap;uniform sampler2D sandN;uniform sampler2D dirtMap;
        uniform vec3 grassMean;uniform vec3 sandMean;uniform float hasNormals;
        float surfaceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float valueNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+vec2(1,1)),f.x),f.y);}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 tuv = vTerrainWorld.xz / 3.0;
        vec2 suv = vTerrainWorld.xz / 4.0;
        // Two scales of the same set, mixed by noise, so the grass never shows a repeating grid.
        float groundPatch = valueNoise(vTerrainWorld.xz * 0.07);
        float groundFine = valueNoise(vTerrainWorld.xz * 0.45);
        vec3 g = mix(texture2D(grassMap, tuv).rgb, texture2D(grassMap, tuv * 0.37 + 0.41).rgb, 0.35 + groundFine * 0.3);
        vec3 dirt = texture2D(dirtMap, tuv * 0.8).rgb;
        g = mix(g, dirt, smoothstep(0.7, 0.9, groundPatch) * 0.6);
        vec3 sd = texture2D(sandMap, suv).rgb;
        vec3 tintColor = diffuseColor.rgb;
        // The biome colour (vertex colour) tints the photographed ground instead of replacing it.
        vec3 natural = mix(g * mix(vec3(1.0), tintColor / max(grassMean, vec3(0.02)) * 0.55, 0.6),
                           sd * mix(vec3(1.0), tintColor / max(sandMean, vec3(0.02)) * 0.5, 0.35), vSandy);
        diffuseColor.rgb = mix(tintColor, natural, 0.88);
        diffuseColor.rgb *= mix(0.9, 1.06, groundFine) * mix(0.94, 1.04, surfaceHash(floor(vTerrainWorld.xz * 3.0)));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (hasNormals > 0.5) {
          vec3 tn = mix(texture2D(grassN, tuv).xyz, texture2D(sandN, suv).xyz, vSandy) * 2.0 - 1.0;
          vec3 geo = normalize(inverseTransformDirection(normal, viewMatrix));
          // Terrain faces up: tangent x is world x, tangent y is world z.
          vec3 worldN = normalize(geo * max(tn.z, 0.2) + vec3(tn.x, 0.0, tn.y) * 0.9);
          normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(texture2D(grassArm, tuv).g * 1.1, 0.55, 1.0);`,
      );
  };
  material.customProgramCacheKey = () => 'district-terrain-v4' + (liteSurfaces ? ':lite' : '');
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.userData.standalone = true;
  return mesh;
}
// The ground split into square chunks (96 m) sharing one material: each chunk has its own bounds, so the ones
// outside the view or beyond the far plane are skipped (the big map's ground is 270 000 triangles).
export function groundChunks(map, cells = 48) {
  const whole = makeGround(map),
    g = whole.geometry,
    nx = Math.round((map.limit.x * 2) / TERRAIN_STEP),
    nz = Math.round((map.limit.z * 2) / TERRAIN_STEP),
    group = new T.Group(),
    names = ['position', 'normal', 'color', 'sandy'];
  for (let z0 = 0; z0 < nz; z0 += cells)
    for (let x0 = 0; x0 < nx; x0 += cells) {
      const x1 = Math.min(nx, x0 + cells),
        z1 = Math.min(nz, z0 + cells),
        w = x1 - x0 + 1,
        h = z1 - z0 + 1,
        part = new T.BufferGeometry();
      for (const name of names) {
        const src = g.attributes[name],
          k = src.itemSize,
          out = new Float32Array(w * h * k);
        for (let z = 0; z < h; z++)
          for (let x = 0; x < w; x++) {
            const from = ((z0 + z) * (nx + 1) + x0 + x) * k,
              to = (z * w + x) * k;
            for (let c = 0; c < k; c++) out[to + c] = src.array[from + c];
          }
        part.setAttribute(name, new T.BufferAttribute(out, k));
      }
      const index = [];
      for (let z = 0; z < h - 1; z++)
        for (let x = 0; x < w - 1; x++) {
          const a = z * w + x,
            b = a + 1,
            c = a + w,
            d = c + 1;
          index.push(a, c, b, b, c, d);
        }
      part.setIndex(index);
      part.computeBoundingSphere();
      const mesh = new T.Mesh(part, whole.material);
      mesh.receiveShadow = true;
      mesh.userData.standalone = true;
      mesh.userData.sharedMaterial = true;
      group.add(mesh);
    }
  g.dispose();
  group.userData.material = whole.material;
  return group;
}
// Sky dome: height gradient, sun disc with a warm halo, and drifting clouds projected on a plane above.
// `envCapture` renders the ground hemisphere dark, for the reflection/ambient environment map.
const SKY_GLSL = `
  uniform vec3 sunDir;uniform float time;uniform float envCapture;
  float skyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float skyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(skyHash(i),skyHash(i+vec2(1,0)),f.x),mix(skyHash(i+vec2(0,1)),skyHash(i+vec2(1,1)),f.x),f.y);}
  float skyFbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*skyNoise(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v;}
  vec3 skyColor(vec3 d){
    float h=d.y;
    vec3 zenith=vec3(0.10,0.28,0.62),horizon=vec3(0.50,0.64,0.80);
    vec3 col=mix(horizon,zenith,pow(clamp(h,0.0,1.0),0.5));
    float s=max(0.0,dot(d,sunDir));
    col+=vec3(1.0,0.72,0.42)*pow(s,6.0)*0.14+vec3(1.0,0.86,0.62)*pow(s,90.0)*0.35;
    if(h>0.0){
      vec2 uv=d.xz/(h+0.12)*2.2+vec2(time*0.012,time*0.005);
      float c=skyFbm(uv);
      float cover=smoothstep(0.42,0.7,c)*smoothstep(0.0,0.2,h);
      // Sunlit tops, greyer bellies where the cloud is thick.
      vec3 lit=mix(vec3(0.78,0.8,0.86),vec3(1.08,1.04,0.98),clamp(0.55+0.45*dot(d,sunDir),0.0,1.0));
      lit*=0.8+0.25*skyFbm(uv*3.3)-0.18*smoothstep(0.6,0.85,c);
      col=mix(col,lit,cover*0.92);
    }
    // Below the horizon: haze fading into the ground colour.
    vec3 ground=envCapture>0.5?vec3(0.20,0.21,0.17):horizon*0.92;
    col=mix(col,ground,smoothstep(0.0,envCapture>0.5?-0.25:-0.1,h));
    if(envCapture<0.5)col+=smoothstep(0.99975,0.99988,s)*vec3(3.0,2.6,2.0);
    return col;
  }`;
export function makeSky(capture = false) {
  const material = new T.ShaderMaterial({
    side: T.BackSide,
    depthWrite: false,
    uniforms: { sunDir: WORLD.sunDir, time: WORLD.time, envCapture: { value: capture ? 1 : 0 } },
    vertexShader:
      'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `${SKY_GLSL}
 varying vec3 vDirection;
 void main(){vec3 d=normalize(vDirection);gl_FragColor=vec4(skyColor(d),1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`,
  });
  const mesh = new T.Mesh(new T.SphereGeometry(270, 32, 16), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
// Environment map for image-based lighting and reflections: the sky with a dark ground, prefiltered once.
export function makeEnvironment(renderer) {
  const scene = new T.Scene(),
    sky = makeSky(true);
  scene.add(sky);
  const pmrem = new T.PMREMGenerator(renderer),
    target = pmrem.fromScene(scene, 0, 0.1, 1000);
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  return target;
}
export function makeWater(p) {
  const material = new T.ShaderMaterial({
    uniforms: { time: WORLD.time, sunDir: WORLD.sunDir, envCapture: { value: 0 } },
    vertexShader: `uniform float time;varying vec3 vWorld;void main(){vec3 p=position;p.z+=sin(p.x*1.8+time)*.018;vec4 world=modelMatrix*vec4(p,1.0);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader: `${SKY_GLSL}
 varying vec3 vWorld;
 void main(){
   vec3 eye=normalize(cameraPosition-vWorld);
   // Ripples: two travelling noise layers tilt the surface normal.
   vec2 q=vWorld.xz*1.3;
   float a=skyNoise(q+vec2(time*0.35,time*0.2)),b=skyNoise(q*2.3-vec2(time*0.3,-time*0.45));
   float c=skyNoise(q+vec2(time*0.35+0.05,time*0.2)),e=skyNoise(q+vec2(time*0.35,time*0.2+0.05));
   vec3 n=normalize(vec3((a-c)*0.9+(b-0.5)*0.12,1.0,(a-e)*0.9));
   float fresnel=0.03+0.97*pow(1.0-max(0.0,dot(eye,n)),5.0);
   vec3 r=reflect(-eye,n);
   vec3 refl=skyColor(normalize(vec3(r.x,abs(r.y),r.z)));
   vec3 deep=vec3(0.05,0.17,0.18),shallow=vec3(0.16,0.33,0.30);
   vec3 col=mix(mix(deep,shallow,0.4+0.3*b),refl,clamp(fresnel,0.0,1.0));
   col+=vec3(1.0,0.9,0.7)*pow(max(0.0,dot(r,sunDir)),220.0)*2.5;
   gl_FragColor=vec4(col,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`,
  });
  const mesh = new T.Mesh(new T.PlaneGeometry(p.w - 0.4, p.d - 0.4, 12, 12), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(p.x, p.y ?? 0.415, p.z);
  mesh.userData.standalone = true;
  return mesh;
}
// Window glass: clear and reflective. Opacity rises at grazing angles (Fresnel), so panes read as glass from the
// street but you still see into rooms when looking straight in.
let glass;
export function glassMaterial() {
  if (glass) return glass;
  glass = new T.MeshStandardMaterial({
    color: 0xb9d6de,
    roughness: 0.04,
    metalness: 0.0,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    envMapIntensity: 1.6,
    side: T.DoubleSide,
  });
  glass.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float glassFresnel = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 4.0);
      diffuseColor.a = clamp(opacity + glassFresnel * 0.7, 0.0, 0.92);
      #include <opaque_fragment>`,
    );
  };
  glass.customProgramCacheKey = () => 'prida-glass';
  return glass;
}
// Leaves and needles: alpha-tested cards that sway in the wind and let light through (sun behind a leaf).
// Geometry supplies a `sway` attribute (0 at the trunk, 1 at the tips).
const foliageCache = new Map();
export function foliageMaterial(kind = 'leaves', color = 0xffffff) {
  const id = kind + ':' + color;
  if (foliageCache.has(id)) return foliageCache.get(id);
  const map = texture(kind),
    material = new T.MeshStandardMaterial({
      color,
      map: map || null,
      alphaTest: map ? 0.45 : 0,
      side: T.DoubleSide,
      roughness: 0.78,
      metalness: 0,
      envMapIntensity: 0.7,
    });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { windTime: WORLD.time, wind: WORLD.wind, sunDir: WORLD.sunDir });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime;uniform vec2 wind;attribute float sway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 anchor = vec3(0.0);
          #ifdef USE_INSTANCING
            anchor = instanceMatrix[3].xyz;
          #endif
          float phase = dot(anchor.xz, vec2(0.21, 0.17)) + dot(position, vec3(0.9, 0.6, 1.3));
          float gust = 0.6 + 0.4 * sin(windTime * 0.7 + anchor.x * 0.05);
          vec2 push = wind * (sin(windTime * 1.9 + phase) * 0.6 + sin(windTime * 3.7 + phase * 1.7) * 0.25) * gust;
          transformed.xz += push * sway * 0.12;
          transformed.y += sin(windTime * 2.3 + phase) * sway * 0.03;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 sunDir;')
      // Crown normals, not card normals: never flip them for the back of a card.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        // Translucency: leaves glow when the sun shines through them toward the camera.
        {
          vec3 viewSun = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
          float through = pow(clamp(dot(-normalize(vViewPosition), viewSun), 0.0, 1.0), 3.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.95, 0.6) * through * 0.9;
          // Light scattered through the canopy: shaded leaves never go black.
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.32, 0.38, 0.26);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'prida-foliage';
  foliageCache.set(id, material);
  return material;
}
// PBR upgrade for the furniture kit's flat-coloured materials: wood grain, woven fabric, brushed metal, glossy
// glass. Keeps each material's colour.
const KIT_LOOKS = {
  wood: ['oak', 0.55],
  woodDark: ['oak', 0.5],
  carpet: ['fabric', 0.9],
  carpetWhite: ['fabric', 0.9],
  carpetBlue: ['fabric', 0.9],
  carpetDarker: ['fabric', 0.9],
  metal: ['metal', 0.35, 0.6],
  metalLight: ['metal', 0.3, 0.3],
  metalMedium: ['metal', 0.35, 0.65],
  metalDark: ['metal', 0.4, 0.55],
};
const kitCache = new Map();
export function kitMaterial(m) {
  if (m.name === 'glass') {
    const g = m.clone();
    g.roughness = 0.05;
    g.metalness = 0;
    g.envMapIntensity = 1.4;
    return g;
  }
  if (m.name === 'lamp') {
    const l = m.clone();
    l.emissive = new T.Color(0xffe2a6);
    l.emissiveIntensity = 0.6;
    return l;
  }
  const look = KIT_LOOKS[m.name];
  if (!look || m.map) return m;
  const key = m.name + ':' + m.color.getHexString();
  if (!kitCache.has(key)) {
    const d = detailMaterial(look[0], m.color.getHex(), { roughness: look[1], metalness: look[2] ?? 0, key: 'kit', strength: 0.7 });
    kitCache.set(key, d);
  }
  return kitCache.get(key);
}
// Kenney car kit bodies (one colour-atlas texture): glossy paint, reflective dark windows, matte tyres.
const carCache = new Map();
export function carMaterial(m) {
  if (carCache.has(m.uuid)) return carCache.get(m.uuid);
  const c = m.clone();
  c.roughness = 0.3;
  c.metalness = 0.2;
  c.envMapIntensity = 1.5;
  c.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float carLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float carTyre = 1.0 - smoothstep(0.035, 0.05, carLum);
        float carGlass = (1.0 - carTyre) * (1.0 - smoothstep(0.08, 0.11, carLum)) * step(diffuseColor.r * 1.05, diffuseColor.b);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(roughnessFactor, 0.9, carTyre), 0.04, carGlass);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor *= 1.0 - carTyre;
        metalnessFactor = mix(metalnessFactor, 0.0, carGlass);`,
      );
  };
  c.customProgramCacheKey = () => 'prida-car';
  carCache.set(m.uuid, c);
  return c;
}
// Street furniture from the same kits: painted metal.
const streetCache = new Map();
export function streetMaterial(m) {
  if (streetCache.has(m.uuid)) return streetCache.get(m.uuid);
  const c = m.clone();
  c.roughness = 0.5;
  c.metalness = 0.35;
  c.envMapIntensity = 1.1;
  streetCache.set(m.uuid, c);
  return c;
}
