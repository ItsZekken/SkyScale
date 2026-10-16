// src/noise.js
// Procedural noise algorithms in pure JS (CPU) and GLSL (GPU)
// Seeded PRNG, 2D Simplex Noise, FBM, Musgrave Ridged Multifractal, Domain Warping, Worley Voronoi

export function createRng(seed = 1) { // mulberry32
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoise(seed = 1337) {
  const rnd = createRng(seed), p = new Uint8Array(256), perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;

  function simplex2(xin, yin) { // range ≈ [-1, 1]
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const g0 = GRAD[perm[ii + perm[jj]] & 7];
    const g1 = GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
    const g2 = GRAD[perm[ii + 1 + perm[jj + 1]] & 7];

    let n = 0;
    let tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) {
      tt *= tt;
      n += tt * tt * (g0[0] * x0 + g0[1] * y0);
    }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) {
      tt *= tt;
      n += tt * tt * (g1[0] * x1 + g1[1] * y1);
    }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) {
      tt *= tt;
      n += tt * tt * (g2[0] * x2 + g2[1] * y2);
    }
    return Math.max(-1, Math.min(1, 70 * n));
  }

  function fbm(x, y, oct = 6, lac = 2.03, gain = 0.5) { // normalized ≈ [-1, 1]
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * simplex2(x * f, y * f);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }

  // Musgrave ridged multifractal: (1 - |n|)^2 with weight feedback. Range ≈ [0, ~1.2]
  function ridged(x, y, oct = 8, lac = 2.03, gain = 0.5) {
    let sum = 0, f = 1, amp = 0.5, w = 1;
    for (let o = 0; o < oct; o++) {
      let n = 1 - Math.abs(simplex2(x * f, y * f));
      n *= n;
      n *= w;
      w = Math.max(0, Math.min(1, n * 2));
      sum += n * amp;
      f *= lac;
      amp *= gain;
    }
    return sum;
  }

  function warp(x, y, amp = 0.6, freq = 0.8) { // domain warping → [x', y']
    return [
      x + amp * fbm(x * freq + 5.2, y * freq + 1.3, 4),
      y + amp * fbm(x * freq - 3.7, y * freq + 8.1, 4)
    ];
  }

  const hash2 = (i, j) => perm[(i & 255) + perm[j & 255]] / 255;

  function worley(x, y) { // {f1, f2} Euclidean distances
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy;
        const px = cx + hash2(cx, cy), py = cy + hash2(cx + 57, cy + 113);
        const d = Math.hypot(px - x, py - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return { f1, f2 };
  }

  return { simplex2, fbm, ridged, warp, worley, hash2 };
}

export const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2  hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3  hash33(vec3 p3){ p3=fract(p3*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }
float gnoise2(vec2 p){
  vec2 i=floor(p), f=fract(p), u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float a=dot(hash22(i)*2.0-1.0,f), b=dot(hash22(i+vec2(1.0,0.0))*2.0-1.0,f-vec2(1.0,0.0));
  float c=dot(hash22(i+vec2(0.0,1.0))*2.0-1.0,f-vec2(0.0,1.0)), d=dot(hash22(i+vec2(1.0,1.0))*2.0-1.0,f-vec2(1.0,1.0));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.41421356;
}
float gnoise3(vec3 p){
  vec3 i=floor(p), f=fract(p), u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float n000=dot(hash33(i)*2.0-1.0,f);
  float n100=dot(hash33(i+vec3(1.0,0.0,0.0))*2.0-1.0,f-vec3(1.0,0.0,0.0));
  float n010=dot(hash33(i+vec3(0.0,1.0,0.0))*2.0-1.0,f-vec3(0.0,1.0,0.0));
  float n110=dot(hash33(i+vec3(1.0,1.0,0.0))*2.0-1.0,f-vec3(1.0,1.0,0.0));
  float n001=dot(hash33(i+vec3(0.0,0.0,1.0))*2.0-1.0,f-vec3(0.0,0.0,1.0));
  float n101=dot(hash33(i+vec3(1.0,0.0,1.0))*2.0-1.0,f-vec3(1.0,0.0,1.0));
  float n011=dot(hash33(i+vec3(0.0,1.0,1.0))*2.0-1.0,f-vec3(0.0,1.0,1.0));
  float n111=dot(hash33(i+vec3(1.0,1.0,1.0))*2.0-1.0,f-vec3(1.0,1.0,1.0));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z)*1.1547;
}
float fbm2(vec2 p,int oct){ float s=0.0,a=0.5,n=0.0; for(int i=0;i<oct;i++){ s+=a*gnoise2(p); n+=a; p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s/n; }
float fbm3(vec3 p,int oct){ float s=0.0,a=0.5,n=0.0; for(int i=0;i<oct;i++){ s+=a*gnoise3(p); n+=a; p=p*2.03+vec3(17.1,9.2,5.3); a*=0.5; } return s/n; }
float ridged2(vec2 p,int oct){ float s=0.0,a=0.5,w=1.0; for(int i=0;i<oct;i++){ float n=1.0-abs(gnoise2(p)); n*=n; n*=w; w=clamp(n*2.0,0.0,1.0); s+=n*a; p=p*2.03+vec2(11.3,5.7); a*=0.5; } return s; }
float ridged3(vec3 p,int oct){ float s=0.0,a=0.5,w=1.0; for(int i=0;i<oct;i++){ float n=1.0-abs(gnoise3(p)); n*=n; n*=w; w=clamp(n*2.0,0.0,1.0); s+=n*a; p=p*2.03+vec3(11.3,5.7,3.1); a*=0.5; } return s; }
vec2 warp2(vec2 p,float amp,float f){ return p+amp*vec2(fbm2(p*f+vec2(5.2,1.3),4),fbm2(p*f+vec2(-3.7,8.1),4)); }
vec3 warp3(vec3 p,float amp,float f){
  return p + amp * vec3(
    fbm3(p * f + vec3(5.2, 1.3, 2.7), 3),
    fbm3(p * f + vec3(-3.7, 8.1, -4.5), 3),
    fbm3(p * f + vec3(1.9, -6.4, 9.1), 3)
  );
}
void worley2(vec2 p,out float f1,out float f2){
  vec2 i=floor(p), f=fract(p); f1=8.0; f2=8.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)); vec2 r=g+hash22(i+g)-f; float d=dot(r,r);
    if(d<f1){f2=f1;f1=d;} else if(d<f2){f2=d;}
  }
  f1=sqrt(f1); f2=sqrt(f2);
}
float worley3Billow(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); float dMin = 4.0;
  for(int z=-1; z<=1; z++){
    for(int y=-1; y<=1; y++){
      for(int x=-1; x<=1; x++){
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 r = g + hash33(i + g) - f;
        dMin = min(dMin, dot(r, r));
      }
    }
  }
  return 1.0 - clamp(sqrt(dMin), 0.0, 1.0);
}
`;
