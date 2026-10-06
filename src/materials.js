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
  plaster: { size: 1.35, albedo: 0.08, tint: 0.95, normal: 1.05 },
  concrete: { size: 1.7, albedo: 0.62, tint: 0.62, normal: 1.05 },
  asphalt: { size: 4, albedo: 0.85, tint: 0.3, normal: 1 },
  paving: { size: 2, albedo: 0.8, tint: 0.35, normal: 1.1 },
  sidewalk: { size: 3, albedo: 0.85, tint: 0.3, normal: 1.1 },
  dirt: { size: 3, albedo: 0.9, tint: 0.2, normal: 1 },
  tiles: { size: 0.85, albedo: 0.92, tint: 0.24, normal: 1.08 },
  wood: { size: 1.05, albedo: 0.86, tint: 0.35, normal: 0.95 },
  oak: { size: 0.82, albedo: 0.48, tint: 0.72, normal: 0.9 },
  roof: { size: 1.75, albedo: 0.94, tint: 0.24, normal: 1.3 },
  claytiles: { size: 1.3, albedo: 1, tint: 0.2, normal: 1.32 },
  corrugated: { size: 2.2, albedo: 0.5, tint: 0.7, normal: 1.4, metal: 0.6 },
  gravel: { size: 2.6, albedo: 0.9, tint: 0.3, normal: 1 },
  metal: { size: 1, albedo: 0.6, tint: 0.6, normal: 1, metal: 1 },
  bark: { size: 1.5, albedo: 0.95, tint: 0.3, normal: 1.3 },
  pinebark: { size: 1.2, albedo: 0.95, tint: 0.3, normal: 1.3 },
  rock: { size: 3, albedo: 0.9, tint: 0.45, normal: 1.3 },
  fabric: { size: 0.7, albedo: 0, tint: 1, normal: 0.9 },
  panels: { size: 1.8, albedo: 0.65, tint: 0.56, normal: 1.06 },
  grass: { size: 3, albedo: 0.9, tint: 0.3, normal: 1 },
  sand: { size: 4, albedo: 0.9, tint: 0.3, normal: 1 },
  steel: { size: 0.6, albedo: 0.4, tint: 0.7, normal: 1, metal: 1 },
  gunmetal: { size: 0.3, albedo: 0.4, tint: 0.7, normal: 1, metal: 1 },
  worn: { size: 0.8, albedo: 0.5, tint: 0.6, normal: 1, metal: 0.8 },
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
  refreshSurfaces();
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
      aoMapIntensity: 1.0,
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
        insideMap: { value: texture('plaster') || map },
        insideNormal: { value: texture('plaster_n') || normalMap || map },
        insideMean: { value: linear(TEXTURES.plaster) },
        detailScale: { value: 1 / look.size },
        detailStrength: { value: Math.min(1, Math.max(0, strength)) },
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
            uniform sampler2D insideMap;uniform sampler2D insideNormal;uniform vec3 insideMean;
          #endif
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
            // A single fragment chooses exterior finish OR painted plaster. No extra wall overlay.
            dInner = step(0.5, -dot(dN, vOut));
            vec2 iUV = (dAbs.x >= dAbs.z ? vDetailPos.zy : vDetailPos.xy) / 1.35;
            if (dInner > 0.5) {
              vec3 grain = clamp(texture2D(insideMap, iUV).rgb / insideMean, 0.65, 1.4);
              diffuseColor.rgb = vec3(0.66, 0.64, 0.60) * mix(vec3(1.0), grain, 0.35);
            }
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
              nt.xy *= detailNormalScale;
              #ifdef DETAIL_INTERIOR
                if (dInner > 0.5) { nt = texture2D(insideNormal, iUV).xyz * 2.0 - 1.0; nt.xy *= 0.4; }
              #endif
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
    material.customProgramCacheKey = () => 'pbr-v029' + (ceiling ? ':ceiling' : '');
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
export function makeGround(map, bounds = null) {
  const { vertices, indices } = terrainMesh(map, bounds),
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
      mountainMap034: { value: tex('rock') || tex('sand') },
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
        uniform vec3 grassMean;uniform vec3 sandMean;uniform float hasNormals;uniform sampler2D mountainMap034;
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
        // Rock on high ridges; snow is altitude-limited so new countryside reads differently from city lawns.
        float mountain034 = smoothstep(8.0, 19.0, vTerrainWorld.y);
        vec3 cliff034 = texture2D(mountainMap034, vTerrainWorld.xz / 3.5).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, cliff034 * vec3(.90,.93,.92), mountain034 * .80);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.78,.82,.83), smoothstep(29.0,38.0,vTerrainWorld.y) * .78);
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
  material.customProgramCacheKey = () => 'district-terrain-v034' + (liteSurfaces ? ':lite' : '');
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
  metal: ['steel', 0.35, 0.6],
  metalLight: ['steel', 0.3, 0.3],
  metalMedium: ['steel', 0.35, 0.65],
  metalDark: ['steel', 0.4, 0.55],
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
    // Kit furniture is built from open shells (a table top, a chair seat): both sides must be drawn.
    d.side = T.DoubleSide;
    kitCache.set(key, d);
  }
  return kitCache.get(key);
}
// ——— Object-space surfaces: things that move (weapons, gear, cars, street props, the chest, the bus) ———
// Same texture sets as the world, projected triplanar in the object's own axes (in metres, whatever the model's
// scale), so a gun's grain stays on the gun as it moves and every car of a batch keeps its own. On top of the
// texture: per-pixel classes for Kenney colour-atlas models (tyres, glass, chrome, paint), road grime near the
// ground, and roughness/metalness from the texture's AO/roughness/metal map around the class's own values.
// Mean AO / roughness / metal of each `_arm` map (measured offline), so the texture varies around a target.
const ARM_MEAN = {
  metal: [0.871, 0.588, 0.384],
  oak: [0.973, 0.529, 0.024],
  concrete: [0.89, 0.784, 0.008],
  fabric: [0.773, 0.659, 0.024],
  asphalt: [0.722, 0.769, 0.02],
  corrugated: [0.863, 0.522, 0.2],
  wood: [0.984, 0.376, 0.008],
  rock: [0.929, 0.635, 0.008],
  pinebark: [0.859, 0.706, 0.012],
  plaster: [0.957, 0.918, 0.004],
  panels: [0.969, 0.737, 0.004],
  steel: [0.996, 0.365, 0.992],
  gunmetal: [0.992, 0.302, 0.996],
  worn: [0.992, 0.353, 0.824],
};
// classify: 0 none · 1 car (tyres, glass, chrome, trim, paint) · 2 prop (rubber, bare metal, brass, paint) ·
// 3 colour-atlas weapon (muted coatings, steel, polymer)
const SURF_DEFAULTS = { surface: 'steel', size: 0.4, albedo: 0, tint: 1, strength: 0.45, normal: 0.6, roughVar: 0.6, classify: 0, grime: null, glass: 1, accent: false, glow: 0 };
const surfaceMaterials = new Set(); // WeakRefs, to recompile everything when the graphics preset changes
function surfaceShader(material, o) {
  const look = lookOf(o.surface);
  return (shader) => {
    surfaceMaterials.add(new WeakRef(material));
    Object.assign(shader.uniforms, {
      objMap: { value: texture(o.surface) },
      objNormal: { value: texture(o.surface + '_n') || texture(o.surface) },
      objArm: { value: texture(o.surface + '_arm') || texture(o.surface) },
      objMean: { value: linear(TEXTURES[o.surface] || [128, 128, 128]) },
      objArmMean: { value: new T.Vector3(...(ARM_MEAN[o.surface] || [0.9, 0.6, 0])) },
      objScale: { value: 1 / o.size },
      objStrength: { value: o.strength },
      objAlbedo: { value: o.albedo },
      objTint: { value: o.tint },
      objNormalScale: { value: o.normal * look.normal },
      objRoughVar: { value: o.roughVar },
      objGrime: { value: new T.Vector3(...(o.grime || [0, 0, 0])) },
      objGlass: { value: o.glass },
      objGlow: { value: o.glow },
    });
    const lite = (liteSurfaces ? '#define OBJ_LITE\n' : '') + (o.accent ? '#define OBJ_ACCENT\n' : '');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;varying vec3 vObjN;varying vec3 vObjX;varying vec3 vObjY;varying vec3 vObjZ;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        mat3 oBasis = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          oBasis = oBasis * mat3(instanceMatrix);
        #endif
        vec3 oScale = max(vec3(length(oBasis[0]), length(oBasis[1]), length(oBasis[2])), vec3(1e-6));
        vObjPos = transformed * oScale;
        vObjN = objectNormal / oScale;
        vObjX = oBasis[0] / oScale.x; vObjY = oBasis[1] / oScale.y; vObjZ = oBasis[2] / oScale.z;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${lite}#define OBJ_CLASSIFY ${o.classify}
        uniform sampler2D objMap;uniform sampler2D objNormal;uniform sampler2D objArm;uniform vec3 objMean;uniform vec3 objArmMean;
        uniform float objScale;uniform float objStrength;uniform float objAlbedo;uniform float objTint;uniform float objNormalScale;
        uniform float objRoughVar;uniform vec3 objGrime;uniform float objGlass;uniform float objGlow;
        varying vec3 vObjPos;varying vec3 vObjN;varying vec3 vObjX;varying vec3 vObjY;varying vec3 vObjZ;
        ${TRIPLANAR}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 oN = normalize(vObjN);
        vec3 oP = vObjPos * objScale;
        #ifdef OBJ_LITE
          vec3 oAbs = abs(oN);
          vec2 oUV = oAbs.x >= oAbs.y && oAbs.x >= oAbs.z ? oP.zy : oAbs.y >= oAbs.z ? oP.xz : oP.xy;
          vec3 ot = texture2D(objMap, oUV).rgb;
          vec3 oArm = objArmMean;
        #else
          vec3 oB = triBlend(oN);
          vec3 ot = triSample(objMap, oP, oB);
          vec3 oArm = triSample(objArm, oP, oB);
        #endif
        float oRough = roughness, oMetal = metalness, oTex = 1.0, oNormalK = 1.0, oGlassK = 0.0;
        // Accent mode (chests): the instance colour paints only the accent parts (brass class) and makes them glow;
        // everything else keeps the model's own colours.
        vec3 oTint = vec3(1.0);
        #if defined( OBJ_ACCENT ) && defined( USE_COLOR )
          oTint = vColor.rgb;
          diffuseColor.rgb /= max(vColor.rgb, vec3(1e-3));
        #endif
        vec3 oBase = diffuseColor.rgb;
        float oAccent = 0.0;
        #if OBJ_CLASSIFY > 0
          // What the atlas colour is: very dark = rubber, light blue = glass (cars), grey = metal or trim, else paint.
          vec3 oS = sqrt(max(oBase, 0.0));
          float oMax = max(oS.r, max(oS.g, oS.b)), oMin = min(oS.r, min(oS.g, oS.b));
          float oSat = (oMax - oMin) / max(oMax, 1e-3);
          float oRubber = 1.0 - smoothstep(0.26, 0.3, oMax);
          #if OBJ_CLASSIFY == 1
            oGlassK = (1.0 - oRubber) * step(0.7, oS.r) * step(0.07, oS.b - oS.r) * step(oS.r, oS.g) * step(0.9, oS.b) * objGlass;
          #endif
          float oGrey = (1.0 - oRubber) * (1.0 - oGlassK) * (1.0 - smoothstep(0.14, 0.24, oSat));
          // Brass fittings on props and weapons; a yellow car is paint (a taxi is not gold-plated).
          float oBrass = OBJ_CLASSIFY == 1 ? 0.0 : (1.0 - oRubber) * (1.0 - oGlassK) * (1.0 - oGrey) * step(0.9, oS.r) * step(0.62, oS.g) * step(oS.b, 0.5);
          float oPaint = max(0.0, 1.0 - oRubber - oGlassK - oGrey - oBrass);
          float oLight = smoothstep(0.5, 0.7, oMax);
          float oL = dot(oBase, vec3(0.2126, 0.7152, 0.0722));
          #if OBJ_CLASSIFY == 1
            // Car paint: less toy-like (a little darker and greyer), glossy and a touch metallic; light greys are
            // chrome, darker blue-greys are black plastic trim; tyres are rubber; windows dark reflective glass.
            vec3 paint = mix(vec3(oL), oBase, 0.82) * 0.72;
            vec3 oGreyC = mix(vec3(oL), oBase, 0.2);
            vec3 trim = mix(oGreyC * vec3(0.3, 0.3, 0.28), oGreyC * 0.95, oLight);
            oBase = paint * oPaint + trim * oGrey + vec3(0.016) * oRubber + vec3(0.012, 0.016, 0.02) * oGlassK + oBase * vec3(0.9, 0.75, 0.45) * oBrass;
            oRough = 0.34 * oPaint + mix(0.62, 0.22, oLight) * oGrey + 0.88 * oRubber + 0.07 * oGlassK + 0.3 * oBrass;
            oMetal = 0.08 * oPaint + mix(0.0, 0.9, oLight) * oGrey + 0.9 * oBrass;
            oTex = 0.25 * oPaint + mix(0.6, 0.3, oLight) * oGrey + 0.8 * oRubber + 0.9 * oBrass;
            oNormalK = 0.15 * oPaint + 0.4 * oGrey + 0.8 * oRubber + 0.4 * oBrass;
          #elif OBJ_CLASSIFY == 3
            // Colour-atlas weapons: toy colours become muted coatings, greys steel, darks polymer.
            vec3 coat = mix(vec3(oL), oBase, 0.35) * 0.55;
            vec3 steel = vec3(oL) * mix(0.35, 0.9, oLight);
            oBase = coat * oPaint + steel * oGrey + vec3(0.025) * oRubber + oBase * vec3(0.9, 0.72, 0.45) * oBrass;
            oRough = 0.5 * oPaint + 0.38 * oGrey + 0.62 * oRubber + 0.3 * oBrass;
            oMetal = 0.2 * oPaint + 0.85 * oGrey + 0.05 * oRubber + 0.95 * oBrass;
            oTex = 0.6 * oPaint + 0.7 * oGrey + 0.6 * oRubber + 0.5 * oBrass;
            oNormalK = 0.6 * oPaint + 0.7 * oGrey + 0.9 * oRubber + 0.4 * oBrass;
          #else
            // Props: painted or bare metal, brass fittings, rubber.
            vec3 metal = mix(vec3(oL), oBase, 0.25) * 0.8;
            oBase = mix(vec3(oL), oBase, 0.85) * 0.85 * oPaint + metal * oGrey + vec3(0.02) * oRubber + oBase * vec3(0.95, 0.8, 0.52) * oBrass;
            oRough = 0.5 * oPaint + 0.42 * oGrey + 0.85 * oRubber + 0.3 * oBrass;
            oMetal = 0.1 * oPaint + 0.7 * oGrey + 0.95 * oBrass;
            oTex = 0.6 * oPaint + 0.8 * oGrey + 0.7 * oRubber + 0.7 * oBrass;
            oNormalK = 0.6 * oPaint + 0.9 * oGrey + 0.7 * oRubber + 0.6 * oBrass;
          #endif
          #ifdef OBJ_ACCENT
            oAccent = oBrass;
            oBase = mix(oBase, oTint * 0.8, oAccent);
          #endif
        #endif
        // Painted: the class colour with the texture's grain. Natural: the texture's own colour, lightly tinted.
        vec3 oPainted = oBase * mix(vec3(1.0), clamp(ot / objMean, 0.0, 2.2), objStrength * oTex);
        vec3 oNatural = ot * mix(vec3(1.0), oBase, objTint);
        diffuseColor.rgb = mix(oPainted, oNatural, objAlbedo);
        // Road dirt: darker and browner towards the ground.
        float oDirt = objGrime.z * (1.0 - smoothstep(objGrime.x, objGrime.y, vObjPos.y)) * (1.0 - oGlassK);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.45, 0.38) + vec3(0.012, 0.01, 0.007), oDirt);
        float oAO = mix(1.0, oArm.r / max(objArmMean.r, 0.05), 0.6);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(oRough + (oArm.g - objArmMean.g) * objRoughVar * oTex + oDirt * 0.35, 0.03, 1.0);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = clamp(oMetal * (1.0 - oDirt * 0.6), 0.0, 1.0);`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= oAO;
        #ifdef OBJ_ACCENT
          totalEmissiveRadiance += oTint * oAccent * objGlow;
        #endif
        reflectedLight.indirectSpecular *= mix(1.0, oAO, 0.6) * (1.0 - oGlassK * 0.35);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifndef OBJ_LITE
        if (objNormalScale * oNormalK > 0.001) {
          vec3 nX = texture2D(objNormal, oP.zy).xyz * 2.0 - 1.0;
          vec3 nY = texture2D(objNormal, oP.xz).xyz * 2.0 - 1.0;
          vec3 nZ = texture2D(objNormal, oP.xy).xyz * 2.0 - 1.0;
          float k = objNormalScale * oNormalK;
          nX.xy *= k; nY.xy *= k; nZ.xy *= k;
          nX = vec3(nX.xy + oN.zy, abs(nX.z) * oN.x);
          nY = vec3(nY.xy + oN.xz, abs(nY.z) * oN.y);
          nZ = vec3(nZ.xy + oN.xy, abs(nZ.z) * oN.z);
          vec3 objN = normalize(nX.zyx * oB.x + nY.xzy * oB.y + nZ.xyz * oB.z);
          vec3 worldN = normalize(vObjX * objN.x + vObjY * objN.y + vObjZ * objN.z);
          normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz) * faceDirection;
        }
        #endif`,
      );
  };
}
// Turns a MeshStandardMaterial into an object-space surface (in place) and returns it. `spec` overrides
// SURF_DEFAULTS; the material's own colour, roughness and metalness are the targets. Clones (weapon finishes)
// keep the look through copySurface().
export function objectSurface(material, spec = {}) {
  const o = { ...SURF_DEFAULTS, ...spec };
  if (!texture(o.surface)) return material;
  material.userData.surface = o;
  material.onBeforeCompile = surfaceShader(material, o);
  material.customProgramCacheKey = () => 'objsurf:' + o.classify + (o.accent ? ':accent' : '') + (liteSurfaces ? ':lite' : '');
  material.needsUpdate = true;
  return material;
}
export function copySurface(from, to) {
  if (from.userData?.surface) objectSurface(to, from.userData.surface);
  return to;
}
function refreshSurfaces() {
  for (const ref of surfaceMaterials) {
    const m = ref.deref();
    if (m) m.needsUpdate = true;
    else surfaceMaterials.delete(ref);
  }
}
// Weapons and gear are flat-coloured low-poly models: every material becomes a real finish. Named materials of
// the Quaternius guns map directly; the unnamed colours of the Kenney kits are sorted by hue and brightness.
const GUN_FINISHES = {
  steel: { color: 0x585b61, roughness: 0.4, metalness: 0.8, surface: 'gunmetal', size: 0.12, strength: 0.55, normal: 0.7, finishable: true },
  darksteel: { color: 0x3b3d42, roughness: 0.34, metalness: 0.85, surface: 'gunmetal', size: 0.12, strength: 0.5, normal: 0.6, finishable: true },
  polymer: { color: 0x2c2d30, roughness: 0.62, metalness: 0.04, surface: 'gunmetal', size: 0.05, strength: 0.4, normal: 0.9, finishable: true },
  rubber: { color: 0x1b1b1c, roughness: 0.85, metalness: 0, surface: 'worn', size: 0.08, strength: 0.3, normal: 0.5 },
  wood: { color: 0x7a4a2a, roughness: 0.52, metalness: 0, surface: 'oak', size: 0.32, albedo: 0.85, tint: 0.62, strength: 0.8, normal: 0.6 },
  darkwood: { color: 0x4a2d1a, roughness: 0.55, metalness: 0, surface: 'oak', size: 0.32, albedo: 0.85, tint: 0.75, strength: 0.8, normal: 0.6 },
  bright: { color: 0xc4c7cc, roughness: 0.22, metalness: 1, surface: 'steel', size: 0.15, strength: 0.4, normal: 0.4 },
  brass: { color: 0xc49a55, roughness: 0.3, metalness: 0.95, surface: 'steel', size: 0.15, strength: 0.3, normal: 0.3 },
  paint: { roughness: 0.46, metalness: 0.15, surface: 'steel', size: 0.25, strength: 0.35, normal: 0.4, finishable: true },
};
const GUN_NAMES = { Grey: 'steel', Grey2: 'darksteel', DarkGrey: 'polymer', Black: 'rubber', Wood: 'wood', DarkWood: 'darkwood', LightGrey: 'bright', Red: 'paint', Main: 'paint' };
export function gunFinishOf(m) {
  if (GUN_NAMES[m.name]) return GUN_NAMES[m.name];
  if (m.map) return 'atlas';
  const hsl = m.color.clone().convertLinearToSRGB().getHSL({}, T.LinearSRGBColorSpace);
  if (hsl.l < 0.12) return hsl.l < 0.05 ? 'rubber' : 'polymer';
  if (hsl.s < 0.22) return hsl.l < 0.32 ? 'polymer' : hsl.l > 0.72 ? 'bright' : hsl.l > 0.45 ? 'steel' : 'darksteel';
  const hue = hsl.h * 360;
  if (hue > 15 && hue < 45 && hsl.l < 0.45) return hsl.l < 0.32 ? 'darkwood' : 'wood';
  if (hue > 25 && hue < 50 && hsl.s > 0.6 && hsl.l > 0.35 && hsl.l < 0.62) return 'brass';
  return 'paint';
}
export function gunMaterial(m) {
  if (m.userData.gunFinish) return m;
  const kind = gunFinishOf(m),
    out = m.clone();
  out.userData.gunFinish = kind;
  if (kind === 'atlas') return objectSurface(Object.assign(out, { roughness: 0.5, metalness: 0.3 }), { surface: 'gunmetal', size: 0.12, strength: 0.5, normal: 0.7, classify: 3 });
  const f = GUN_FINISHES[kind];
  if (f.color !== undefined) out.color.setHex(f.color);
  else {
    // Paint: the model's colour, a little deeper and less toy-bright.
    const hsl = out.color.getHSL({});
    out.color.setHSL(hsl.h, hsl.s * 0.8, hsl.l * 0.75);
  }
  out.roughness = f.roughness;
  out.metalness = f.metalness;
  out.envMapIntensity = 1;
  out.userData.finishable = !!f.finishable;
  return objectSurface(out, { surface: f.surface, size: f.size, strength: f.strength, normal: f.normal, albedo: f.albedo || 0, tint: f.tint ?? 1 });
}
// Kenney car kit bodies (one colour-atlas texture): glossy paint, dark reflective glass, chrome and rubber, grime
// towards the road.
const carCache = new Map();
export function carMaterial(m) {
  if (carCache.has(m.uuid)) return carCache.get(m.uuid);
  const c = objectSurface(Object.assign(m.clone(), { roughness: 0.3, metalness: 0.2, envMapIntensity: 1 }), {
    surface: 'steel',
    size: 0.8,
    strength: 0.3,
    normal: 0.5,
    classify: 1,
    grime: [0.05, 0.6, 0.55],
  });
  carCache.set(m.uuid, c);
  return c;
}
// Street furniture from the same kits: concrete barriers, painted or bare metal, plastic cones, wooden poles.
const PROP_SURFACES = {
  barrier: { surface: 'concrete', size: 1.1, albedo: 0.92, tint: 0.12, strength: 0.8, normal: 1, grime: [0, 0.4, 0.4], roughness: 0.85, metalness: 0 },
  cone: { surface: 'concrete', size: 0.25, strength: 0.15, normal: 0.25, classify: 2, grime: [0, 0.12, 0.5], roughness: 0.55, metalness: 0 },
  'power-pole': { surface: 'oak', size: 0.9, albedo: 0.9, tint: 0.35, strength: 0.8, normal: 0.8, roughness: 0.8, metalness: 0, color: 0x6b5442 },
  dumpster: { surface: 'worn', size: 1, strength: 0.6, normal: 0.8, classify: 2, grime: [0, 0.7, 0.6] },
};
const streetCache = new Map();
export function streetMaterial(m, model = '') {
  const key = m.uuid + ':' + model;
  if (streetCache.has(key)) return streetCache.get(key);
  const spec = PROP_SURFACES[model] || { surface: 'steel', size: 0.8, strength: 0.5, normal: 0.7, classify: 2, grime: [0, 0.5, 0.45] },
    c = Object.assign(m.clone(), { roughness: spec.roughness ?? 0.5, metalness: spec.metalness ?? 0.35, envMapIntensity: 1.1 });
  if (spec.color !== undefined) c.color.setHex(spec.color);
  objectSurface(c, spec);
  streetCache.set(key, c);
  return c;
}
