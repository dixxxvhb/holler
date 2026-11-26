// Every look in the camera. One fragment shader runs them all; the TS list below is the source of
// truth and the shader's look numbers are generated from it, so the two can't drift.
//
// Kinds:  color = a grade you can fade in and out
//         warp  = bends the picture around a point you drag; breathes with your voice
//         art   = turns the picture into a drawing style
//         motion = uses the last frame (trails, glitches, feedback)
//         back  = needs the on-device cutout of you (background blur, color pop...)

export type LookKind = 'color' | 'warp' | 'art' | 'motion' | 'back';
export type Look = { id: string; label: string; kind: LookKind; amt: number; voice?: boolean; history?: boolean; seg?: boolean; drag?: boolean };

export const LOOKS: Look[] = [
  { id: 'none', label: 'Natural', kind: 'color', amt: 1 },
  { id: 'warm', label: 'Golden hour', kind: 'color', amt: 1 },
  { id: 'film', label: 'Film', kind: 'color', amt: 1 },
  { id: 'cine', label: 'Movie', kind: 'color', amt: 1 },
  { id: 'vivid', label: 'Vivid', kind: 'color', amt: 1 },
  { id: 'cool', label: 'Blue hour', kind: 'color', amt: 1 },
  { id: 'flash', label: 'Disposable', kind: 'color', amt: 1 },
  { id: 'mono', label: 'Mono', kind: 'color', amt: 1 },
  { id: 'noir', label: 'Noir', kind: 'color', amt: 1 },
  { id: 'dream', label: 'Dreamy', kind: 'color', amt: 1 },
  { id: 'retro', label: 'VHS', kind: 'color', amt: 1 },
  { id: 'pop', label: 'Poster', kind: 'color', amt: 1 },

  { id: 'bulge', label: 'Big head', kind: 'warp', amt: 0.6, voice: true, drag: true },
  { id: 'pinch', label: 'Tiny face', kind: 'warp', amt: 0.6, voice: true, drag: true },
  { id: 'swirl', label: 'Swirl', kind: 'warp', amt: 0.55, voice: true, drag: true },
  { id: 'jelly', label: 'Jelly', kind: 'warp', amt: 0.5, voice: true },
  { id: 'stretch', label: 'Noodle', kind: 'warp', amt: 0.55, drag: true },
  { id: 'twin', label: 'Twins', kind: 'warp', amt: 0.3, drag: true },
  { id: 'kaleido', label: 'Kaleidoscope', kind: 'warp', amt: 0.5, voice: true, drag: true },
  { id: 'zoom', label: 'Warp speed', kind: 'warp', amt: 0.5, voice: true, drag: true },

  { id: 'halftone', label: 'Comic dots', kind: 'art', amt: 0.5 },
  { id: 'neon', label: 'Neon lines', kind: 'art', amt: 0.7, voice: true },
  { id: 'sketch', label: 'Pencil', kind: 'art', amt: 0.6 },
  { id: 'pixel', label: '8-bit', kind: 'art', amt: 0.45 },
  { id: 'riso', label: 'Riso print', kind: 'art', amt: 0.6 },
  { id: 'thermal', label: 'Heat vision', kind: 'art', amt: 0.7, voice: true },
  { id: 'xray', label: 'X-ray', kind: 'art', amt: 0.7 },

  { id: 'echo', label: 'Light trails', kind: 'motion', amt: 0.6, history: true },
  { id: 'rainbow', label: 'Rainbow ghost', kind: 'motion', amt: 0.6, history: true },
  { id: 'infinity', label: 'Infinity', kind: 'motion', amt: 0.6, history: true, drag: true },
  { id: 'glitch', label: 'Glitch', kind: 'motion', amt: 0.5, voice: true },
  { id: 'drop', label: 'Bass drop', kind: 'motion', amt: 0.7, voice: true },

  { id: 'blur', label: 'Blur behind', kind: 'back', amt: 0.6, seg: true },
  { id: 'colorpop', label: 'Color pop', kind: 'back', amt: 1, seg: true },
  { id: 'spot', label: 'Spotlight', kind: 'back', amt: 0.7, seg: true },
  { id: 'sunset', label: 'Sunset wall', kind: 'back', amt: 1, seg: true },
  { id: 'aura', label: 'Aura', kind: 'back', amt: 0.7, seg: true, voice: true },
];

export type LookId = string;
export const KINDS: { id: LookKind; label: string; note: string }[] = [
  { id: 'color', label: 'Color', note: 'Slide to fade it in or out.' },
  { id: 'warp', label: 'Warp', note: 'Drag on the picture to move it. Most of these move with your voice.' },
  { id: 'art', label: 'Art', note: 'Slide for more or less.' },
  { id: 'motion', label: 'Motion', note: 'Move around. These leave trails.' },
  { id: 'back', label: 'Background', note: 'Finds you and changes everything behind you.' },
];
export const lookOf = (id: string) => LOOKS.find(l => l.id === id) || LOOKS[0];

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
vec3 blurV(vec2 q, float r){
  vec3 s = vec3(0.); float n = 0.;
  for (int i = 0; i < 16; i++) { float a = float(i)*2.39996; float d = sqrt(float(i)+.5)/4.; s += V(q + vec2(cos(a),sin(a))*d*r/res); n += 1.; }
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
  else if (look == L_film) { c = mix(vec3(.08,.06,.07), vec3(.97,.93,.86), c); c = sat(c,.82); c.r = pow(c.r,.95); c.b = pow(c.b,1.08); c += (rndt(q*res)-.5)*.07; c *= mix(.72,1.,vig); }
  else if (look == L_cine) { float l = lum(c); c = mix(c*vec3(.82,1.02,1.1), c*vec3(1.14,1.,.8), smoothstep(.15,.75,l)); c = sat(c,1.15); c = (c-.5)*1.1+.5; c *= mix(.78,1.,vig); }
  else if (look == L_vivid) { c = sat(c,1.45); c = (c-.5)*1.12+.5; }
  else if (look == L_cool) { c = c*vec3(.88,.98,1.12) + vec3(0.,.01,.04); c = sat(c,.9); }
  else if (look == L_flash) { float hot = 1.-smoothstep(0.,.6,length((q-vec2(.5,.55))*ASP())); c = c*(1.1+.35*hot) + .05; c = sat(c,1.2); c = pow(c, vec3(.92,.95,1.05)); c += (rndt(q*res)-.5)*.06; c *= mix(.55,1.,vig); }
  else if (look == L_mono) { float l = lum(c); l = (l-.5)*1.1+.5; c = vec3(l); }
  else if (look == L_noir) { float l = lum(c); l = smoothstep(.12,.88,l); c = vec3(l)*mix(.45,1.,vig); c += (rndt(q*res)-.5)*.06; }
  else if (look == L_dream) { vec3 b = blurV(q, 14.); c = max(c, b*1.1); c = mix(c, vec3(1.,.86,.92), .12); c = sat(c,.9)*1.04; }
  else if (look == L_retro) { float o = 2.5/res.x; c = vec3(V(q+vec2(o,0.)).r, c.g, V(q-vec2(o,0.)).b); c = sat(c,1.25); c *= .9 + .1*sin(q.y*res.y*1.6); c += (rnd(vec2(q.y*40., t))-.5)*.05; c *= mix(.7,1.,vig); }
  else if (look == L_pop) { c = sat(c,1.6); c = floor(c*5.)/5.; c *= 1. - smoothstep(.18,.4,edge(q,1.5)); }
  return c;
}
void main(){
  vec2 q = uv; vec3 orig = V(q); vec3 c = orig;
  float k = amt; float kv = amt*(1.+lvl*1.4);
  if (look <= L_pop) { c = mix(orig, grade(orig, q), amt); }
  // ---- warp ----
  else if (look == L_bulge) c = V(polarWarp(q, kv, 0));
  else if (look == L_pinch) c = V(polarWarp(q, kv, 1));
  else if (look == L_swirl) c = V(polarWarp(q, kv*(1.+.15*sin(t*1.7)), 2));
  else if (look == L_jelly) { vec2 w = vec2(sin(q.y*11.+t*3.6), cos(q.x*9.+t*2.9))*.022*(k+.2)*(1.+lvl*3.); c = V(q + w); }
  else if (look == L_stretch) { vec2 d = q-ctr; float band = exp(-d.y*d.y*14.); c = V(ctr + vec2(d.x*(1.+k*1.4*band), d.y*(1.-k*.25))); }
  else if (look == L_twin) { vec2 w = q; float m = ctr.x; if (w.x > m) w.x = 2.*m - w.x; if (k > .5 && w.y < ctr.y) w.y = 2.*ctr.y - w.y; c = V(w); }
  else if (look == L_kaleido) {
    vec2 d = (q-ctr)*ASP(); float r = length(d)*(1.-.25*lvl); float a = atan(d.y, d.x) + t*.25*k;
    float seg = floor(4. + k*8.); float s = 2.*PI/seg; a = mod(a, s); a = abs(a - s*.5);
    c = V(ctr + vec2(cos(a), sin(a))*r/ASP());
  }
  else if (look == L_zoom) {
    vec3 s = vec3(0.); vec2 d = q-ctr; float st = (.012 + .03*k)*(1.+lvl*2.5);
    for (int i = 0; i < 12; i++) s += V(q - d*st*float(i));
    c = s/12.; c = mix(c, orig, .25);
  }
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
  else if (look == L_pixel) {
    float b = mix(5., 20., k); vec2 cq = (floor(q*res/b)+.5)*b/res; vec3 col = sat(V(cq), 1.3);
    c = floor(col*4.+.5)/4.; vec2 f = fract(q*res/b); c *= .82 + .18*step(.12, f.x)*step(.12, f.y);
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
  else if (look == L_xray) {
    float l = 1.-lum(orig); float e = smoothstep(.1, .6, edge(q, 1.5));
    c = vec3(.55,.85,1.)*pow(l, 1.6)*(.6+.6*k) + vec3(.7,.95,1.)*e*.8; c += (rndt(q*res)-.5)*.04;
  }
  // ---- motion ----
  else if (look == L_echo) { vec3 p = P(q); c = max(orig, p*(.8 + .17*k)); }
  else if (look == L_rainbow) { vec3 p = P(q); c = mix(orig, p, vec3(.88,.72,.45)*(.55+.4*k)); }
  else if (look == L_infinity) { float z = .985 - .025*k; vec3 p = P(ctr + (q-ctr)*z); c = mix(p, orig, .28 + .3*(1.-k)); }
  else if (look == L_glitch) {
    float tick = floor(t*9.); float row = floor(q.y*(18.+k*20.));
    float on = step(.86 - lvl*.6 - k*.2, rnd(vec2(row, tick)));
    float sh = (rnd(vec2(row*1.7, tick))-.5)*.18*on; float o = (.004 + .012*k)*(1.+lvl*2.);
    c = vec3(V(q+vec2(sh+o,0.)).r, V(q+vec2(sh,0.)).g, V(q+vec2(sh-o,0.)).b);
    if (rnd(vec2(tick, row*3.1)) > .985 - lvl*.05) c = 1.-c;
    c *= .92 + .08*sin(q.y*res.y*2.);
  }
  else if (look == L_drop) {
    float punch = lvl*lvl*(.3+.5*k); vec2 w = ctr + (q-ctr)*(1.-punch*.35); float o = punch*.03;
    c = vec3(V(w+vec2(o,0.)).r, V(w).g, V(w-vec2(o,0.)).b);
    c *= 1. + punch*.6; c *= mix(1.-punch*.8, 1., smoothstep(.8, .2, length(q-.5)));
  }
  // ---- background (needs the cutout) ----
  else if (look >= L_blur) {
    float m = M(q); vec3 bg = orig;
    if (look == L_blur) bg = blurV(q, 10. + k*30.);
    else if (look == L_colorpop) bg = mix(orig, vec3(lum(orig)), k);
    else if (look == L_spot) bg = orig*mix(.6, .12, k) * vec3(.85,.9,1.1);
    else if (look == L_sunset) {
      float y = q.y + .03*sin(q.x*6.+t*.8); vec3 g1 = vec3(1.,.55,.3), g2 = vec3(1.,.35,.55), g3 = vec3(.35,.2,.6);
      vec3 grad = y < .5 ? mix(g1, g2, y*2.) : mix(g2, g3, (y-.5)*2.);
      grad += .06*sin(vec3(q.y*20.+t, q.x*15.-t, t*.5));
      bg = mix(orig, grad, k);
    }
    else if (look == L_aura) {
      float halo = 0.; for (int i = 0; i < 12; i++) { float a = float(i)*.5236; halo += M(q + vec2(cos(a), sin(a))*(.03 + .03*lvl)*vec2(1., res.x/res.y)); }
      halo = halo/12.; vec3 hue = hsv(fract(t*.1 + q.y*.4), .8, 1.);
      bg = orig*mix(.8, .25, k) + hue*halo*(1.-m)*(1.1 + lvl*1.5);
    }
    vec3 fg = look == L_spot ? orig*1.08 : look == L_colorpop ? sat(orig, 1.25) : orig;
    c = mix(bg, fg, m);
  }
  vec4 o = texture2D(ov, vec2(q.x, 1.-q.y));
  gl_FragColor = vec4(mix(clamp(c, 0., 1.), o.rgb, o.a), 1.);
}`;
