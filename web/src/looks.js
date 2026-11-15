// The three looks (R32): Diorama, Survey sheet and Helmet HUD, the prototype's universal ways to read a 3D model
// (design-reference/map-prototype/web/app.js THEMES), applied to the site terrain and its trip-area surround. And the
// terrain shader hook they share with the factor views: the look's surface colour, an overlay PNG draped by lon/lat
// (a factor view's data over the current look) and contour lines. Footprints keep the assessment colours in every look.
import * as THREE from 'three';

// THEMES, verbatim where the site uses them. Diorama's photo keeps the lights Task 9d's colour fit was measured with
// (site.js), so `lights: null`. Each look is its own scene (R33): background, block sides, floor and camera; the
// globe tiles are hidden while a site is open, so the site stands as a lifted-out block.
export const LOOKS = Object.freeze({
  diorama: Object.freeze({
    name: 'Diorama', layer: 'photo_tint', exag: 2, contours: false, contourInterval: 5, contourColor: 0x3a1d10, contourOpacity: 0.35,
    wallTop: 0x93583a, wallBottom: 0x3b2015, wallMode: 'solid', ground: 'shadow', shadowOpacity: 0.2,
    hemiSky: 0xfff4e8, hemiGround: 0x7a4a33, hemi: 1.25, sun: 2.3, sunColor: 0xfff0dc, exposure: 1.0, photoDim: 1, lights: null,
    background: 0x070b0f, floor: 0x2a1f19, camera: { altM: 2600, tiltDeg: 50 }, // oblique, far enough to see the block
  }),
  // A printed site planning sheet: warm paper, a low-contrast hillshade, 2 m contours with 10 m index contours, flat
  // slope classes and a 500 m grid, drawn unlit (sheet.js adds the labels and the map furniture).
  survey: Object.freeze({
    name: 'Survey sheet', layer: 'hillshade', exag: 2, contours: true, contourInterval: 2, contourColor: 0x8a5a36, contourOpacity: 0.9,
    contourWidth: [0.05, 0.75], contourMinorAlpha: 0.7,
    wallTop: 0xe4dccb, wallBottom: 0xe4dccb, wallMode: 'solid', ground: 'none', // the margin's tone, so a step at the box edge reads as a sliver
    hemiSky: 0xffffff, hemiGround: 0xbdbdb4, hemi: 1.5, sun: 1.3, sunColor: 0xffffff, exposure: 1.0, photoDim: 1,
    paper: 0xf4efe3, lights: true, background: 0xe4dccb, floor: null, camera: { altM: 1500, tiltDeg: 8 }, // steep, near top-down
    hill: 0x6e5a48, gridColor: 0x3f5f78, neatColor: 0x1d2226, gridStepM: 500,
    classes: { buildable: 0x6fa86a, marginal: 0xe8a92e, steep: 0xe0502a, steepInk: 0x9b2d10, nodata: 0x8c8c8c },
    slopeLimitDeg: 5, steepDeg: 15, // buildable ≤ 5° (the scenario's construction limit, as the checks use), marginal to 15°
  }),
  hud: Object.freeze({
    name: 'Helmet HUD', layer: 'photo_grey', exag: 2.5, contours: true, contourInterval: 5, contourColor: 0x6fe3ff, contourOpacity: 0.55,
    wallTop: 0x6fe3ff, wallBottom: 0x6fe3ff, wallMode: 'lines', ground: 'grid',
    hemiSky: 0xa9dcff, hemiGround: 0x0a1422, hemi: 0.9, sun: 1.7, sunColor: 0xe6f6ff, exposure: 0.95, photoDim: 0.72, lights: true,
    background: 0x06101a, floor: null, grid: [0x2f6f8a, 0x1a3a4c], camera: { altM: 150, tiltDeg: 76 }, // low, looking across the layout
  }),
});
export const LOOK_ORDER = ['diorama', 'survey', 'hud'];
export const LOOK_MODE = { diorama: 0, survey: 1, hud: 2 };

// The uniforms every terrain material of one site shares (one object, so a look or an overlay changes them all at once).
export function lookUniforms() {
  return {
    lookMode: { value: 0 },
    paper: { value: new THREE.Color(LOOKS.survey.paper) },
    wallTop: { value: new THREE.Color(LOOKS.diorama.wallTop) },
    wallBottom: { value: new THREE.Color(LOOKS.diorama.wallBottom) },
    sheetLight: { value: 1 }, // 1: the sheet is drawn unlit (0 while the Solar view's sun casts shadows)
    sheetHill: { value: new THREE.Color(LOOKS.survey.hill) },
    sheetClass: { value: ['buildable', 'marginal', 'steep', 'steepInk', 'nodata'].map((k) => new THREE.Color(LOOKS.survey.classes[k])) },
    sheetLimits: { value: new THREE.Vector2(LOOKS.survey.slopeLimitDeg, LOOKS.survey.steepDeg) },
    sheetGrid: { value: LOOKS.survey.gridStepM },
    sheetGridColor: { value: new THREE.Color(LOOKS.survey.gridColor) },
    sheetNeat: { value: new THREE.Color(LOOKS.survey.neatColor) },
    sheetBox: { value: new THREE.Vector4(0, 0, 0, 0) }, // the site box (w, s, e, n offsets from the frame centre)
    sheetBoxOn: { value: 0 },
    contourOn: { value: 0 },
    contourInterval: { value: 5 },
    contourColor: { value: new THREE.Color(0x000000) },
    contourOpacity: { value: 0 },
    contourWidth: { value: new THREE.Vector2(0.3, 0.8) }, // minor and index line half-widths, px past the core
    contourMinorAlpha: { value: 0.55 },
    overlayOn: { value: 0 },
    overlayMap: { value: null },
    overlayBox: { value: new THREE.Vector4(0, 0, 1, 1) }, // w, s, e, n as offsets from the site frame centre (degrees)
    overlayOpacity: { value: 0.6 },
  };
}

// Point the shared uniforms at a look (the lights and walls are site.js's).
export function setLookUniforms(U, look) {
  const t = LOOKS[look] || LOOKS.diorama;
  U.lookMode.value = LOOK_MODE[look] || 0;
  U.contourOn.value = t.contours ? 1 : 0;
  U.contourInterval.value = t.contourInterval;
  U.contourColor.value.set(t.contourColor);
  U.contourOpacity.value = t.contourOpacity;
  U.contourWidth.value.fromArray(t.contourWidth || [0.3, 0.8]);
  U.contourMinorAlpha.value = t.contourMinorAlpha || 0.55;
  U.wallTop.value.set(t.wallTop);
  U.wallBottom.value.set(t.wallBottom);
}

// The hook on a terrain material (after drapeMaterial's and before slopeBlend's): the look's colour before the slope
// colouring, then the overlay and the contours after it. wall: the material of a skirt (Survey paints walls solid).
// Attributes: elevation (m, every terrain geometry has it), sheetSlope (degrees over 10 m, -1 without data; the Survey
// sheet's slope classes, filled by sheet.js the first time the sheet is shown) and lonLat (offsets from the frame centre, filled when an
// overlay is first shown; until then an overlay is off).
export function lookBlend(material, U, { wall = false } = {}) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  const base = prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(material) : 'site-ramp';
  const W = { value: wall ? 1 : 0 };
  material.onBeforeCompile = (sh, renderer) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, renderer);
    Object.assign(sh.uniforms, U, { uWall: W });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float elevation;\nattribute vec2 lonLat;\nattribute float wallT;\nattribute float sheetSlope;\nvarying float vElev;\nvarying vec2 vLonLat;\nvarying float vWallT;\nvarying float vSheetSlope;\nvarying vec3 vObjN;\nvarying vec2 vObjXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElev = elevation;\nvLonLat = lonLat;\nvWallT = wallT;\nvSheetSlope = sheetSlope;\nvObjN = normal;\nvObjXZ = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform int lookMode; uniform vec3 paper; uniform vec3 wallTop; uniform vec3 wallBottom; uniform float uWall;',
        'varying float vWallT; varying float vSheetSlope; varying vec3 vObjN; varying vec2 vObjXZ;',
        'uniform float sheetLight; uniform vec3 sheetHill; uniform vec3 sheetClass[ 5 ]; uniform vec2 sheetLimits;',
        'uniform float sheetGrid; uniform vec3 sheetGridColor; uniform vec3 sheetNeat; uniform vec4 sheetBox; uniform float sheetBoxOn;',
        'uniform vec2 contourWidth; uniform float contourMinorAlpha;',
        // diagonal hatching in screen pixels: lines every `gap` px, 1 px wide (dir 1: /, -1: \\)
        'float sheetHatch( float dir, float gap ) { float h = abs( mod( gl_FragCoord.x + dir * gl_FragCoord.y, gap ) - 0.5 * gap ); return 1.0 - smoothstep( 0.5, 1.3, h ); }',
        // paper, a low-contrast hillshade (a north-west sun on the normal, relief x3 so gentle ground still reads), then
        // the slope class: buildable a faint green, marginal amber, too steep red-orange with / hatching, no data grey with \\
        'vec3 sheetColour() {',
        '  vec3 n = normalize( vObjN ); vec3 ne = normalize( vec3( n.x * 3.0, n.y, n.z * 3.0 ) );',
        '  vec3 L = normalize( vec3( -0.6, 1.0, -0.6 ) ); float s = clamp( dot( ne, L ), 0.0, 1.0 ) / L.y;',
        '  vec3 c = mix( paper, sheetHill, clamp( 1.0 - s, 0.0, 1.0 ) * 0.6 );',
        '  c = mix( c, vec3( 1.0 ), clamp( s - 1.0, 0.0, 1.0 ) * 0.35 );',
        '  float d = vSheetSlope;',
        '  if ( d < -0.5 ) { c = mix( c, sheetClass[ 4 ], 0.22 ); c = mix( c, sheetClass[ 4 ] * 0.5, sheetHatch( -1.0, 8.0 ) * 0.55 ); }',
        '  else if ( d <= sheetLimits.x ) c = mix( c, sheetClass[ 0 ], 0.10 );',
        '  else if ( d <= sheetLimits.y ) c = mix( c, sheetClass[ 1 ], 0.38 );',
        '  else { c = mix( c, sheetClass[ 2 ], 0.36 ); c = mix( c, sheetClass[ 3 ], sheetHatch( 1.0, 9.0 ) * 0.5 ); }',
        '  return c;',
        '}',
        'uniform float contourOn; uniform float contourInterval; uniform vec3 contourColor; uniform float contourOpacity;',
        'uniform float overlayOn; uniform sampler2D overlayMap; uniform vec4 overlayBox; uniform float overlayOpacity;',
        'varying float vElev; varying vec2 vLonLat;',
      ].join('\n'))
      .replace('#include <alphamap_fragment>', [
        'if ( uWall > 0.5 ) diffuseColor.rgb = mix( wallTop, wallBottom, vWallT );', // the block's sides, every look
        'else if ( lookMode == 1 ) diffuseColor.rgb = sheetColour();', // the planning sheet's paper, hillshade and slope classes
        'else if ( lookMode == 2 ) diffuseColor.rgb = vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) );',
        '#include <alphamap_fragment>',
      ].join('\n'))
      .replace('#include <emissivemap_fragment>', [
        'if ( overlayOn > 0.5 ) {',
        '  vec2 ouv = ( vLonLat - overlayBox.xy ) / ( overlayBox.zw - overlayBox.xy );',
        '  if ( ouv.x >= 0.0 && ouv.x <= 1.0 && ouv.y >= 0.0 && ouv.y <= 1.0 ) {',
        '    vec4 o = texture2D( overlayMap, ouv );',
        '    diffuseColor.rgb = mix( diffuseColor.rgb, o.rgb, o.a * overlayOpacity );',
        '  }',
        '}',
        'if ( contourOn > 0.5 && uWall < 0.5 ) {', // the prototype's contour lines: minor every interval, index every 5th
        '  float t = vElev / contourInterval; float w = fwidth( t );',
        '  float line = 1.0 - clamp( abs( fract( t - 0.5 ) - 0.5 ) / max( w, 1e-4 ) - contourWidth.x, 0.0, 1.0 );',
        '  float tm = t / 5.0; float wm = fwidth( tm );',
        '  float major = 1.0 - clamp( abs( fract( tm - 0.5 ) - 0.5 ) / max( wm, 1e-4 ) - contourWidth.y, 0.0, 1.0 );',
        '  float fade = 1.0 - smoothstep( 0.2, 0.55, w );',
        '  diffuseColor.rgb = mix( diffuseColor.rgb, contourColor, max( line * contourMinorAlpha * fade, major ) * contourOpacity );',
        '}',
        'if ( lookMode == 1 && uWall < 0.5 ) {', // the sheet's 500 m grid (local east and north) and the site box's neat line
        '  vec2 gq = vObjXZ / sheetGrid; vec2 gw = max( fwidth( gq ), vec2( 1e-6 ) );',
        '  vec2 gd = abs( fract( gq - 0.5 ) - 0.5 ) / gw;',
        '  float gl = 1.0 - clamp( min( gd.x, gd.y ) - 0.1, 0.0, 1.0 );',
        '  diffuseColor.rgb = mix( diffuseColor.rgb, sheetGridColor, gl * 0.55 );',
        '  if ( sheetBoxOn > 0.5 ) {',
        '    vec2 lw = max( fwidth( vLonLat ), vec2( 1e-12 ) );',
        '    float inX = step( sheetBox.x - lw.x, vLonLat.x ) * step( vLonLat.x, sheetBox.z + lw.x );',
        '    float inY = step( sheetBox.y - lw.y, vLonLat.y ) * step( vLonLat.y, sheetBox.w + lw.y );',
        '    float dx = min( abs( vLonLat.x - sheetBox.x ), abs( vLonLat.x - sheetBox.z ) ) / lw.x;',
        '    float dy = min( abs( vLonLat.y - sheetBox.y ), abs( vLonLat.y - sheetBox.w ) ) / lw.y;',
        '    float nl = max( inY * ( 1.0 - clamp( dx - 0.9, 0.0, 1.0 ) ), inX * ( 1.0 - clamp( dy - 0.9, 0.0, 1.0 ) ) );',
        '    diffuseColor.rgb = mix( diffuseColor.rgb, sheetNeat, nl * 0.9 );',
        '  }',
        '}',
        '#include <emissivemap_fragment>',
      ].join('\n'))
      // the sheet is printed, not lit: its colour as it is (unless the Solar view's sun is casting shadows)
      .replace('#include <opaque_fragment>', 'if ( lookMode == 1 && sheetLight > 0.5 ) outgoingLight = diffuseColor.rgb;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => base + '+look-v2';
  return material;
}

// Line walls (HUD): each skirt's top rim, and every `every`-th vertical edge. Skirt triangles come in sixes per rim
// edge (a top, a bottom, b top, b top, a bottom, b bottom: site.js buildSkirt).
export function wallLines(skirt, colour, { every = 6, opacity = 0.7 } = {}) {
  const P = skirt.attributes.position.array, n = P.length / 18, out = [];
  const v = (k) => out.push(P[3 * k], P[3 * k + 1], P[3 * k + 2]);
  for (let m = 0; m < n; m++) {
    const o = 6 * m;
    v(o); v(o + 2); // the top edge
    if (m % every === 0) { v(o); v(o + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity }));
  lines.name = 'wall-lines';
  lines.raycast = () => {};
  return lines;
}
