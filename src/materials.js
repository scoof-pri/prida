import * as T from 'three';
import { terrainMesh, biomeAt } from './terrain.js';
import { texture, TEXTURES } from './assets.js';
const linear = (rgb) => new T.Vector3(...rgb.map((c) => Math.pow(c / 255, 2.2)));
// World-space triplanar detail texture. The texture is divided by its mean colour, so the material keeps the
// game's flat palette and only borrows the texture's detail (grain, bricks, planks). Works on batched and
// instanced geometry because it projects from world coordinates.
const detailCache = new Map();
export function detailMaterial(name, color, { scale = 0.5, strength = 0.6, roughness = 0.9, key = '', ceiling = false } = {}) {
  const id = [name, color, scale, strength, roughness, key, ceiling].join(':');
  if (detailCache.has(id)) return detailCache.get(id);
  const map = texture(name),
    material = new T.MeshStandardMaterial({ color, roughness });
  if (map) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms ??= {};
      shader.uniforms.detailMap = { value: map };
      shader.uniforms.detailMean = { value: linear(TEXTURES[name]) };
      shader.uniforms.detailScale = { value: scale };
      shader.uniforms.detailStrength = { value: strength };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNormal;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
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
          '#include <common>\nuniform sampler2D detailMap;uniform vec3 detailMean;uniform float detailScale;uniform float detailStrength;varying vec3 vDetailPos;varying vec3 vDetailNormal;',
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 dn = pow(abs(normalize(vDetailNormal)), vec3(4.0));
          dn /= dn.x + dn.y + dn.z;
          vec3 dt = texture2D(detailMap, vDetailPos.zy * detailScale).rgb * dn.x
            + texture2D(detailMap, vDetailPos.xz * detailScale).rgb * dn.y
            + texture2D(detailMap, vDetailPos.xy * detailScale).rgb * dn.z;
          diffuseColor.rgb *= mix(vec3(1.0), clamp(dt / detailMean, 0.0, 2.2), detailStrength);
          ${ceiling ? `float ceilingFace = (1.0 - smoothstep(-0.8, -0.4, normalize(vDetailNormal).y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.76, 0.72), ceilingFace * 0.75);` : ''}`,
        );
      // Ceilings face away from sun and sky: a soft bounce keeps rooms from reading as a black lid.
      if (ceiling)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.32 * (1.0 - smoothstep(-0.8, -0.4, normalize(vDetailNormal).y));',
        );
    };
    material.customProgramCacheKey = () => 'detail:' + name + (ceiling ? ':ceiling' : '');
  }
  detailCache.set(id, material);
  return material;
}
export function makeGround(map) {
  const { vertices, indices } = terrainMesh(map),
    colors = new Float32Array(vertices.length),
    palette = {
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
  const c = new T.Color();
  for (let i = 0; i < vertices.length; i += 3) {
    c.setHex(palette[biomeAt(vertices[i], vertices[i + 2], map)]);
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
  const grass = texture('grass'),
    sand = texture('sand');
  material.onBeforeCompile = (shader) => {
    shader.uniforms ??= {};
    shader.uniforms.grassMap = { value: grass };
    shader.uniforms.sandMap = { value: sand };
    shader.uniforms.grassMean = { value: linear(TEXTURES.grass) };
    shader.uniforms.sandMean = { value: linear(TEXTURES.sand) };
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
        '#include <common>\nvarying vec3 vTerrainWorld;varying float vSandy;uniform sampler2D grassMap;uniform sampler2D sandMap;uniform vec3 grassMean;uniform vec3 sandMean;\nfloat surfaceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grain=surfaceHash(floor(vTerrainWorld.xz*5.0));
        diffuseColor.rgb*=mix(0.96,1.03,grain);
        vec3 g=texture2D(grassMap,vTerrainWorld.xz*0.28).rgb/grassMean;
        vec3 sd=texture2D(sandMap,vTerrainWorld.xz*0.22).rgb/sandMean;
        // A second, larger-scale sample breaks up visible tiling.
        g=mix(g,texture2D(grassMap,vTerrainWorld.xz*0.061+0.37).rgb/grassMean,0.35);
        diffuseColor.rgb*=mix(vec3(1.0),clamp(mix(g,sd,vSandy),0.0,2.0),0.55);`,
      );
  };
  material.customProgramCacheKey = () => 'district-terrain-v2';
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.userData.standalone = true;
  return mesh;
}
export function makeSky() {
  const material = new T.ShaderMaterial({
    side: T.BackSide,
    depthWrite: false,
    vertexShader:
      'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vDirection;
 void main(){vec3 d=normalize(vDirection);float height=clamp(d.y,0.0,1.0);vec3 horizon=vec3(.74,.84,.82),zenith=vec3(.27,.51,.68);vec3 col=mix(horizon,zenith,pow(height,.65));float sun=max(0.0,dot(d,normalize(vec3(-.45,.82,.44))));col+=vec3(1.0,.68,.34)*(pow(sun,90.0)*.18+smoothstep(.9991,.9996,sun)*1.6);gl_FragColor=vec4(col,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`,
  });
  const mesh = new T.Mesh(new T.SphereGeometry(270, 20, 12), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
export function makeWater(p) {
  const material = new T.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `uniform float time;varying vec3 vWorld;void main(){vec3 p=position;p.z+=sin(p.x*1.8+time)*.018;vec4 world=modelMatrix*vec4(p,1.0);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader: `uniform float time;varying vec3 vWorld;void main(){vec3 eye=normalize(cameraPosition-vWorld);float fresnel=pow(1.0-max(0.0,eye.y),3.0);float ripple=sin(vWorld.x*2.8+time*1.1)*cos(vWorld.z*3.1-time*.8);vec3 color=mix(vec3(.10,.35,.35),vec3(.62,.81,.77),fresnel);color+=pow(max(0.0,ripple),12.0)*.22;gl_FragColor=vec4(color,1.0);
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
