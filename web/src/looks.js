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
  survey: Object.freeze({
    name: 'Survey sheet', layer: 'hillshade', exag: 2, contours: true, contourInterval: 10, contourColor: 0x1d2226, contourOpacity: 0.3,
    wallTop: 0xdedbd2, wallBottom: 0xc6c3b9, wallMode: 'solid', ground: 'none',
    hemiSky: 0xffffff, hemiGround: 0xbdbdb4, hemi: 1.5, sun: 1.3, sunColor: 0xffffff, exposure: 1.0, photoDim: 1,
    paper: 0xe9e6dd, lights: true, background: 0xe9e6dd, floor: null, camera: { altM: 1500, tiltDeg: 8 }, // steep, near top-down
    slopeLimitDeg: 5, // the tick on the slope ramp's key
  }),
  hud: Object.freeze({
    name: 'Helmet HUD', layer: 'photo_grey', exag: 2.5, contours: true, contourInterval: 5, contourColor: 0x6fe3ff, contourOpacity: 0.55,
    wallTop: 0x6fe3ff, wallBottom: 0x6fe3ff, wallMode: 'lines', ground: 'grid',
    hemiSky: 0xa9dcff, hemiGround: 0x0a1422, hemi: 0.9, sun: 1.7, sunColor: 0xe6f6ff, exposure: 0.95, photoDim: 0.72, lights: true,
    background: 0x06101a, floor: null, grid: [0x2f6f8a, 0x1a3a4c], camera: { altM: 150, tiltDeg: 76 }, // low, looking across the layout
  }),
});
export const LOOK_ORDER = ['diorama', 'survey', 'hud'];
// The prototype survey's slope ramp (BLUE), 0 to 30 degrees.
export const SLOPE_BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
export const SLOPE_BLUE_MAX = 30;
export const LOOK_MODE = { diorama: 0, survey: 1, hud: 2 };

// The uniforms every terrain material of one site shares (one object, so a look or an overlay changes them all at once).
export function lookUniforms() {
  return {
    lookMode: { value: 0 },
    paper: { value: new THREE.Color(LOOKS.survey.paper) },
    wallTop: { value: new THREE.Color(LOOKS.diorama.wallTop) },
    wallBottom: { value: new THREE.Color(LOOKS.diorama.wallBottom) },
    blue: { value: SLOPE_BLUE.map((c) => new THREE.Color(c)) },
    contourOn: { value: 0 },
    contourInterval: { value: 5 },
    contourColor: { value: new THREE.Color(0x000000) },
    contourOpacity: { value: 0 },
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
  U.wallTop.value.set(t.wallTop);
  U.wallBottom.value.set(t.wallBottom);
}

// The hook on a terrain material (after drapeMaterial's and before slopeBlend's): the look's colour before the slope
// colouring, then the overlay and the contours after it. wall: the material of a skirt (Survey paints walls solid).
// Attributes: elevation (m, every terrain geometry has it) and lonLat (offsets from the frame centre, filled when an
// overlay is first shown; until then an overlay is off).
export function lookBlend(material, U, { wall = false } = {}) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  const base = prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(material) : 'site-ramp';
  const W = { value: wall ? 1 : 0 };
  material.onBeforeCompile = (sh, renderer) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, renderer);
    Object.assign(sh.uniforms, U, { uWall: W });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float elevation;\nattribute vec2 lonLat;\nattribute float wallT;\nvarying float vElev;\nvarying vec2 vLonLat;\nvarying float vWallT;\nvarying float vSlopeDeg;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElev = elevation;\nvLonLat = lonLat;\nvWallT = wallT;\nvSlopeDeg = degrees( acos( clamp( normal.y, -1.0, 1.0 ) ) );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform int lookMode; uniform vec3 paper; uniform vec3 wallTop; uniform vec3 wallBottom; uniform float uWall; uniform vec3 blue[ 13 ];',
        'varying float vWallT; varying float vSlopeDeg;',
        'vec3 blueRamp( float d ) { float t = clamp( d / 30.0, 0.0, 1.0 ) * 12.0; int i = int( min( floor( t ), 11.0 ) );',
        '  vec3 a = blue[ 0 ], b = blue[ 1 ]; for ( int k = 0; k < 12; k++ ) { if ( k == i ) { a = blue[ k ]; b = blue[ k + 1 ]; } }',
        '  return mix( a, b, t - float( i ) ); }',
        'uniform float contourOn; uniform float contourInterval; uniform vec3 contourColor; uniform float contourOpacity;',
        'uniform float overlayOn; uniform sampler2D overlayMap; uniform vec4 overlayBox; uniform float overlayOpacity;',
        'varying float vElev; varying vec2 vLonLat;',
      ].join('\n'))
      .replace('#include <alphamap_fragment>', [
        'if ( uWall > 0.5 ) diffuseColor.rgb = mix( wallTop, wallBottom, vWallT );', // the block's sides, every look
        'else if ( lookMode == 1 ) diffuseColor.rgb = blueRamp( vSlopeDeg );', // the survey's slope ramp
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
        'if ( contourOn > 0.5 && uWall < 0.5 ) {', // the prototype's contour lines: minor every interval, major every 5th
        '  float t = vElev / contourInterval; float w = fwidth( t );',
        '  float line = 1.0 - clamp( abs( fract( t - 0.5 ) - 0.5 ) / max( w, 1e-4 ) - 0.3, 0.0, 1.0 );',
        '  float tm = t / 5.0; float wm = fwidth( tm );',
        '  float major = 1.0 - clamp( abs( fract( tm - 0.5 ) - 0.5 ) / max( wm, 1e-4 ) - 0.8, 0.0, 1.0 );',
        '  float fade = 1.0 - smoothstep( 0.2, 0.55, w );',
        '  diffuseColor.rgb = mix( diffuseColor.rgb, contourColor, max( line * 0.55 * fade, major ) * contourOpacity );',
        '}',
        '#include <emissivemap_fragment>',
      ].join('\n'));
  };
  material.customProgramCacheKey = () => base + '+look-v1';
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
