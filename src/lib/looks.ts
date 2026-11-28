// Every look in the camera: the 16 that held up on a real face (11-28; there were 37, judged with
// scripts/look-sheet.mjs). A saved preference or an old holler can still name one that is gone: lookOf() and
// lookId() fall back to Natural. One fragment shader runs them all; the TS list below is the source of
// truth and the shader's look numbers are generated from it, so the two can't drift.
//
// Kinds:  color = a grade you can fade in and out
//         warp  = bends the picture around a point you drag; breathes with your voice
//         art   = turns the picture into a drawing style
//         back  = needs the on-device cutout of you (blur, spotlight, a new wall)

export type LookKind = 'color' | 'warp' | 'art' | 'back';
export type Look = { id: string; label: string; kind: LookKind; amt: number; voice?: boolean; history?: boolean; seg?: boolean; drag?: boolean };

export const LOOKS: Look[] = [
  { id: 'none', label: 'Natural', kind: 'color', amt: 1 },
  { id: 'warm', label: 'Golden hour', kind: 'color', amt: 1 },
  { id: 'cine', label: 'Movie', kind: 'color', amt: 1 },
  { id: 'noir', label: 'Noir', kind: 'color', amt: 1 },
  { id: 'retro', label: 'VHS', kind: 'color', amt: 1 },

  { id: 'bulge', label: 'Big head', kind: 'warp', amt: 0.6, voice: true, drag: true },
  { id: 'pinch', label: 'Tiny face', kind: 'warp', amt: 0.6, voice: true, drag: true },
  { id: 'twin', label: 'Twins', kind: 'warp', amt: 0.3, drag: true },

  { id: 'halftone', label: 'Comic dots', kind: 'art', amt: 0.5 },
  { id: 'neon', label: 'Neon lines', kind: 'art', amt: 0.7, voice: true },
  { id: 'sketch', label: 'Pencil', kind: 'art', amt: 0.6 },
  { id: 'riso', label: 'Riso print', kind: 'art', amt: 0.6 },
  { id: 'thermal', label: 'Heat vision', kind: 'art', amt: 0.7, voice: true },

  { id: 'blur', label: 'Blur behind', kind: 'back', amt: 0.6, seg: true },
  { id: 'spot', label: 'Spotlight', kind: 'back', amt: 0.7, seg: true },
  { id: 'sunset', label: 'Sunset wall', kind: 'back', amt: 1, seg: true },
];

export type LookId = string;
export const KINDS: { id: LookKind; label: string; note: string }[] = [
  { id: 'color', label: 'Color', note: 'Slide to fade it in or out.' },
  { id: 'warp', label: 'Warp', note: 'Drag on the picture to move it. Most of these move with your voice.' },
  { id: 'art', label: 'Art', note: 'Slide for more or less.' },
  { id: 'back', label: 'Background', note: 'Finds you and changes everything behind you.' },
];
export const lookOf = (id: string) => LOOKS.find(l => l.id === id) || LOOKS[0];
/** The id to use for a saved or stored look name: itself if it still exists, otherwise Natural. */
export const lookId = (id: unknown): LookId => (typeof id === 'string' && LOOKS.some(l => l.id === id) ? id : 'none');

const defines = LOOKS.map((l, i) => `#define L_${l.id} ${i}`).join('\n');

export const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

export const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
${defines}
varying vec2 uv;
uniform sampler2D vid; uniform sampler2D ov; uniform sampler2D prev; uniform sampler2D mask;
uniform vec4 crop; uniform float mirror; uniform int look; uniform float t; uniform vec2 res;
uniform float amt; uniform float lvl; uniform vec2 ctr; uniform float hasMask;
const float PI = 3.14159265;
float lum(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
float rndt(vec2 co){ return rnd(co + fract(t*7.13)); }
vec3 sat(vec3 c, float s){ return mix(vec3(lum(c)), c, s); }
vec2 srcUV(vec2 q){ q = clamp(q, 0.001, .999); vec2 u = vec2(q.x, 1.-q.y); if (mirror > .5) u.x = 1.-u.x; return crop.xy + u*crop.zw; }
vec3 V(vec2 q){ return texture2D(vid, srcUV(q)).rgb; }
float M(vec2 q){ return hasMask > .5 ? texture2D(mask, srcUV(q)).r : 1.; }
vec3 P(vec2 q){ return texture2D(prev, clamp(q, 0., 1.)).rgb; }
vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); return v*mix(vec3(1.),k,s); }
vec2 ASP(){ return vec2(res.x/res.y, 1.); }
float edge(vec2 q, float px){
  vec2 o = vec2(px/res.x, px/res.y);
  float tl = lum(V(q+vec2(-o.x,o.y))), tc = lum(V(q+vec2(0.,o.y))), tr = lum(V(q+o));
  float ml = lum(V(q-vec2(o.x,0.))), mr = lum(V(q+vec2(o.x,0.)));
  float bl = lum(V(q-o)), bc = lum(V(q-vec2(0.,o.y))), br = lum(V(q+vec2(o.x,-o.y)));
  float gx = (tr+2.*mr+br)-(tl+2.*ml+bl); float gy = (tl+2.*tc+tr)-(bl+2.*bc+br);
  return length(vec2(gx,gy));
}
// the blur behind you: samples that land on you count for almost nothing, so you don't smear into a glow around your own head
vec3 blurBG(vec2 q, float r){
  vec3 s = vec3(0.); float n = 0.;
  for (int i = 0; i < 16; i++) { float a = float(i)*2.39996; float d = sqrt(float(i)+.5)/4.; vec2 p = q + vec2(cos(a),sin(a))*d*r/res; float w = 1. - M(p)*.96; s += V(p)*w; n += w; }
  return s/n;
}
vec2 polarWarp(vec2 q, float k, int mode){
  vec2 d = (q-ctr)*ASP(); float r = length(d); float R = .5;
  if (r < R && r > 0.0001) {
    float f = r/R;
    if (mode == 0) f = pow(f, 1.+k*1.6);
    else if (mode == 1) f = pow(f, 1./(1.+k*1.3));
    else { float a = k*5.*(1.-f)*(1.-f); float cs = cos(a), sn = sin(a); d = vec2(d.x*cs-d.y*sn, d.x*sn+d.y*cs); return ctr + d/ASP(); }
    d = d/r*f*R;
  }
  return ctr + d/ASP();
}
vec3 grade(vec3 c, vec2 q){
  float vig = smoothstep(1.15, .35, length(q-.5)*1.4);
  if (look == L_warm) { c = c*vec3(1.08,1.0,.86) + vec3(.03,.015,0.); c = sat(c,1.12); c *= mix(.8,1.,vig); }
  else if (look == L_cine) { float l = lum(c); c = mix(c*vec3(.82,1.02,1.1), c*vec3(1.14,1.,.8), smoothstep(.15,.75,l)); c = sat(c,1.15); c = (c-.5)*1.1+.5; c *= mix(.78,1.,vig); }
  else if (look == L_noir) { float l = lum(c); l = smoothstep(.12,.88,l); c = vec3(l)*mix(.45,1.,vig); c += (rndt(q*res)-.5)*.06; }
  else if (look == L_retro) { float o = 2.5/res.x; c = vec3(V(q+vec2(o,0.)).r, c.g, V(q-vec2(o,0.)).b); c = sat(c,1.25); c *= .9 + .1*sin(q.y*res.y*1.6); c += (rnd(vec2(q.y*40., t))-.5)*.05; c *= mix(.7,1.,vig); }
  return c;
}
void main(){
  vec2 q = uv; vec3 orig = V(q); vec3 c = orig;
  float k = amt; float kv = amt*(1.+lvl*1.4);
  if (look <= L_retro) { c = mix(orig, grade(orig, q), amt); }
  // ---- warp ----
  else if (look == L_bulge) c = V(polarWarp(q, kv, 0));
  else if (look == L_pinch) c = V(polarWarp(q, kv, 1));
  else if (look == L_twin) { vec2 w = q; float m = ctr.x; if (w.x > m) w.x = abs(2.*m - w.x); if (k > .5 && w.y < ctr.y) w.y = 1. - abs(1. - (2.*ctr.y - w.y)); c = V(w); }
  // ---- art ----
  else if (look == L_halftone) {
    float cs = mix(16., 6., k); vec2 px = q*res; float a = .785; mat2 R = mat2(cos(a),-sin(a),sin(a),cos(a));
    vec2 g = R*px/cs; vec2 cell = (floor(g)+.5)*cs; vec2 cq = (cell*R)/res;
    vec3 col = V(cq); float l = lum(col); float rad = sqrt(1.-l)*.62;
    float d = length(fract(g)-.5); float dt = smoothstep(rad+.05, rad-.05, d);
    vec3 ink = sat(col, 1.8)*.85; c = mix(vec3(.98,.95,.88), ink, dt);
    c *= 1. - .8*smoothstep(.35,.7,edge(q,1.5));
  }
  else if (look == L_neon) {
    float e = smoothstep(.08, .5, edge(q, 1.5)); vec3 hue = hsv(fract(t*.08 + q.y*.6 + q.x*.2), .85, 1.);
    c = hue*e*(1.4+lvl*2.) + orig*.12*(1.-k);
    c += hue*.25*smoothstep(.05,.3,edge(q, 4.))*(.6+lvl);
  }
  else if (look == L_sketch) {
    float e = edge(q, 1.); float l = lum(orig); vec2 px = q*res;
    float h1 = step(.5, fract((px.x+px.y)/5.)); float h2 = step(.5, fract((px.x-px.y)/5.));
    float shade = 1.; if (l < .55) shade -= .18*h1; if (l < .32) shade -= .2*h2;
    float ink = 1. - smoothstep(.1, .45 - k*.2, e);
    c = vec3(.96,.94,.9)*shade*ink; c = mix(c, c*vec3(.95,.92,.86), rnd(floor(px/2.))*.15);
  }
  else if (look == L_riso) {
    float o = 3./res.x; float a = 1.-lum(V(q+vec2(o,0.))); float b = 1.-lum(V(q-vec2(o,o)));
    vec2 px = q*res; float gr = rnd(floor(px)); a = smoothstep(.25, .9, a + (gr-.5)*.25*k); b = smoothstep(.4, 1., b + (rnd(floor(px)+3.)-.5)*.25*k);
    vec3 paper = vec3(.97,.94,.88); vec3 pink = vec3(1.,.35,.6); vec3 blue = vec3(.1,.38,.85);
    c = paper*mix(vec3(1.), pink, a)*mix(vec3(1.), blue, b*.85);
  }
  else if (look == L_thermal) {
    float h = clamp(lum(orig)*(.85+.3*k) + lvl*.25, 0., 1.);
    c = h < .25 ? mix(vec3(0.,0.,.15), vec3(.1,.1,.8), h*4.) : h < .5 ? mix(vec3(.1,.1,.8), vec3(.85,.1,.6), (h-.25)*4.)
      : h < .75 ? mix(vec3(.85,.1,.6), vec3(1.,.55,0.), (h-.5)*4.) : mix(vec3(1.,.55,0.), vec3(1.,1.,.85), (h-.75)*4.);
  }
  // ---- background (needs the cutout) ----
  else if (look >= L_blur) {
    float m = M(q); vec3 bg = orig;
    if (look == L_blur) bg = blurBG(q, 10. + k*30.);
    else if (look == L_spot) bg = orig*mix(.6, .12, k) * vec3(.85,.9,1.1);
    else if (look == L_sunset) {
      float y = q.y + .03*sin(q.x*6.+t*.8); vec3 g1 = vec3(1.,.55,.3), g2 = vec3(1.,.35,.55), g3 = vec3(.35,.2,.6);
      vec3 grad = y < .5 ? mix(g1, g2, y*2.) : mix(g2, g3, (y-.5)*2.);
      grad += .06*sin(vec3(q.y*20.+t, q.x*15.-t, t*.5));
      bg = mix(orig, grad, k);
    }
    vec3 fg = look == L_spot ? orig*1.08 : orig;
    c = mix(bg, fg, m);
  }
  vec4 o = texture2D(ov, vec2(q.x, 1.-q.y));
  gl_FragColor = vec4(mix(clamp(c, 0., 1.), o.rgb, o.a), 1.);
}`;
