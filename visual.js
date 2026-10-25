/* Orione — 360° generative landscapes in one fragment shader.
   Screen → view direction from heading/elevation/roll, so the world stays put while you turn. */
'use strict';
const Visual = (() => {
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform vec2 uRes; uniform float uTime, uHead, uElev, uRoll, uFovY, uSeed, uWorld, uLevel, uBass, uFlash, uFade;
uniform vec3 uC0, uC1, uC2, uC3, uC4; uniform vec4 uWP;
uniform vec4 uEl[10]; uniform vec3 uElC[10]; uniform float uElN;
uniform vec4 uTouch[4]; uniform vec4 uRip[8];
#define PI 3.14159265
float h1(float n){return fract(sin(n*127.1)*43758.5453);}
float h2(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p,int oct){float s=0.,a=.5;for(int i=0;i<6;i++){if(i>=oct)break;s+=a*noise(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return s;}
float adiff(float a,float b){return mod(a-b+PI,2.*PI)-PI;}
vec3 dirOf(float a,float e){return vec3(cos(e)*sin(a),sin(e),cos(e)*cos(a));}

void main(){
  float asp=uRes.x/uRes.y;
  vec2 c=vUv-.5; c.x*=asp;
  float cr=cos(uRoll), sr=sin(uRoll); c=vec2(cr*c.x-sr*c.y, sr*c.x+cr*c.y);
  float a=uHead+c.x*uFovY, el=uElev+c.y*uFovY;
  vec3 dir=dirOf(a,el);
  vec2 cs=vec2(cos(a),sin(a));
  float W=uWorld, t=uTime;
  bool LUNA=W<.5, MARTE=W>.5&&W<1.5, ORIONE=W>1.5&&W<2.5, DIST=W>2.5&&W<3.5, ABISSO=W>3.5;

  /* ---------- sky ---------- */
  float hz=clamp(el*1.4+.08,0.,1.);
  vec3 col=mix(uC1,uC0,pow(hz,.55));
  // horizon glow breathes with the music
  col+=uC3*exp(-abs(el)*14.)*(.12+uLevel*.5);
  // nebula
  vec2 np=dir.xz/(1.2+dir.y)*1.6+uSeed*7.;
  float neb=fbm(np+vec2(t*.004,0.),5), neb2=fbm(np*1.7-vec2(0.,t*.003)+3.,4);
  float sky=smoothstep(-.02,.35,el);
  col+=mix(uC3,uC4,neb2)*pow(neb,2.6)*1.2*uWP.w*sky;
  // stars
  vec3 sp=dir*170.; vec3 ci=floor(sp); float sh=h3(ci+uSeed);
  if(sh>.982){vec3 so=fract(sp)-.5; float d=length(so); float tw=.6+.4*sin(t*(1.+sh*5.)+sh*90.);
    col+=vec3(1.,.95,.88)*smoothstep(.22,0.,d)*tw*uWP.w*sky*(.7+uLevel);}
  // planet / sun
  float pa=uSeed*6.283+1.3, pe=.28+fract(uSeed*3.7)*.2;
  vec3 pd=dirOf(pa,pe); float dd=acos(clamp(dot(dir,pd),-1.,1.));
  float pr=LUNA?.14:MARTE?.05:ORIONE?.2:DIST?.22:.0;
  if(DIST){ // smog sun with stripes
    float sd=dd/pr; vec2 lp=vec2(adiff(a,pa),el-pe);
    if(sd<1.){float stripe=step(.5,fract(lp.y*28./pr*.12-t*.15)); float cut=lp.y<0.?stripe:1.;
      col=mix(col,mix(uC3,uC4*1.2,clamp(-lp.y/pr*.5+.5,0.,1.)),cut*.92);}
    col+=uC3*exp(-dd*5.)*.35;
  } else if(pr>0.){
    if(dd<pr){vec2 lp=vec2(adiff(a,pa),el-pe)/pr; float z=sqrt(max(0.,1.-dot(lp,lp)));
      float sh2=clamp(dot(normalize(vec3(lp,z)),normalize(vec3(-.6,.4,.7))),0.,1.);
      vec3 pc=LUNA?mix(vec3(.1,.3,.7),vec3(.9),smoothstep(.45,.7,fbm(lp*3.+uSeed*5.,4))):
             MARTE?vec3(.75,.7,.62):mix(uC4*.6,uC3,fbm(vec2(lp.y*6.,lp.x),3));
      col=mix(col,pc*(.08+sh2*1.1),smoothstep(1.,.96,length(lp)));}
    col+=(LUNA?vec3(.3,.5,1.):uC3)*exp(-max(0.,dd-pr)*18.)*.25;
    if(ORIONE){ // ring
      vec2 lp=vec2(adiff(a,pa),el-pe)/pr; vec2 rp=vec2(lp.x, lp.y*4.+lp.x*.9); float rr=length(rp);
      float ring=smoothstep(.04,0.,abs(rr-1.7))*.8+smoothstep(.1,0.,abs(rr-2.1))*.4;
      if(!(dd<pr&&lp.y*4.+lp.x*.9>0.)) col+=uC3*ring*.6;}
    if(MARTE){ vec3 p2=dirOf(pa+.6,pe+.12); float d2=acos(clamp(dot(dir,p2),-1.,1.)); col=mix(col,vec3(.55,.5,.45),smoothstep(.025,.02,d2)); }
  }
  if(ORIONE){ // Orion: shoulders, belt, feet
    float oa=uSeed*6.283+3.6, oe=.45;
    for(int i=0;i<7;i++){
      vec2 s=i==0?vec2(-.09,.13):i==1?vec2(.07,.12):i==2?vec2(-.03,-.005):i==3?vec2(0.,0.):i==4?vec2(.03,.005):i==5?vec2(-.07,-.14):vec2(.09,-.13);
      vec3 sd=dirOf(oa+s.x,oe+s.y); float d=acos(clamp(dot(dir,sd),-1.,1.));
      vec3 sc=i==0?vec3(1.,.55,.3):vec3(.75,.85,1.);
      col+=sc*(exp(-d*d*9e4)*1.6+exp(-d*80.)*.12)*(.8+.2*sin(t*2.+float(i)));
    }
    vec3 m42=dirOf(oa,oe-.06); float dm=acos(clamp(dot(dir,m42),-1.,1.));
    col+=mix(uC4,vec3(1.,.4,.6),.5)*exp(-dm*dm*900.)*fbm(dir.xy*40.,3)*.9;
  }
  if(ABISSO){ // light shafts from the surface
    float ray=pow(fbm(vec2(a*6.+t*.05,el*.5),3),3.)*smoothstep(-.1,.6,el);
    col+=uC3*ray*.5; col*=.7;
  }

  /* ---------- elements as stars / sigils ---------- */
  for(int i=0;i<10;i++){
    if(float(i)>=uElN)break;
    vec4 E=uEl[i]; vec3 ed=dirOf(E.x,E.y); float d=acos(clamp(dot(dir,ed),-1.,1.));
    float lv=E.z, r=.018+lv*.03;
    vec3 ec=uElC[i];
    float core=exp(-d*d/(r*r)*2.), halo=exp(-d/(r*3.))*.35;
    float ring=exp(-pow((d-r*(1.6+fract(t*.4+float(i)*.37)*2.))/ (r*.25),2.))*.5*(1.-fract(t*.4+float(i)*.37));
    col+=ec*(core*(.6+lv)+halo*(.4+lv*1.4)+ring*(.3+lv))*(.45+E.w*.55);
  }

  /* ---------- terrain ---------- */
  float far=(.015+fbm(cs*2.1+uSeed*13.,4)*.11)*uWP.x;
  float mid=(fbm(cs*4.7+uSeed*7.+5.,3)-.32)*.075*uWP.y;
  vec3 haze=mix(uC1,uC3,.15);
  if(el<far){
    float sh=fbm(vec2(a*14.,el*30.)+uSeed,3);
    vec3 fc=mix(uC2*.45,haze,.55+sh*.15);
    fc+=uC3*smoothstep(.006,0.,far-el)*.35;   // rim light
    col=fc;
  }
  // structures on the middle distance
  float sbase=mid;
  if(ORIONE){
    for(int k=0;k<4;k++){float fk=float(k); float ak=uSeed*9.+fk*1.71+h1(fk+uSeed)*.6, w=.07+h1(fk*3.+uSeed)*.11, H=w*.78;
      float da=adiff(a,ak), hp=H*(1.-abs(da)/w)+sbase;
      if(abs(da)<w&&el<hp&&el>sbase-.02){
        vec3 pc=uC2*(da<0.?.95:.5); float rows=floor((el-sbase)/H*14.);
        float glyph=step(.86,h2(vec2(rows,floor(da/w*20.)+fk*31.)))*step(.5,fract(t*.3+h1(rows+fk)));
        col=pc+uC3*glyph*(.6+uLevel*1.5)+uC3*smoothstep(.004,0.,hp-el)*.3;}}
    float ob=uSeed*4.+2.9, dao=adiff(a,ob);
    if(abs(dao)<.012&&el<sbase+.16-max(0.,(el-sbase-.14))*3.){col=uC2*.35+uC4*step(.97,fract(el*60.-t))*uLevel;}
  }
  if(MARTE){
    for(int k=0;k<3;k++){float fk=float(k); float ak=uSeed*5.+fk*2.2, r=.035+h1(fk+uSeed)*.03;
      vec2 q=vec2(adiff(a,ak),el-sbase); if(length(q)<r&&q.y>-.01){col=mix(uC2*.35,uC4*.5,.2)+uC3*smoothstep(.003,0.,abs(length(q)-r*.8))*.6;}
      if(abs(q.x-r*.4)<.0012&&q.y<r*1.6&&q.y>0.) col=uC2*.3;
      if(length(q-vec2(r*.4,r*1.6))<.004) col+=vec3(1.,.1,.05)*step(.5,fract(t*.8+fk));}
  }
  if(LUNA){
    float am=uSeed*8.+.7, dm=adiff(a,am);
    if(abs(dm)<.008&&el<sbase+.1&&el>sbase-.02) col=vec3(.02)+uC3*smoothstep(.002,0.,abs(dm)-.006)*.2;
  }
  if(DIST){
    for(int k=0;k<16;k++){float fk=float(k); float ak=uSeed*3.+fk*.39+h1(fk*7.)*.25, w=.008+h1(fk+.3)*.02, H=.04+pow(h1(fk*1.7+uSeed),2.)*.28;
      float da=adiff(a,ak);
      if(abs(da)<w&&el<sbase+H&&el>sbase-.03){
        vec2 wp=vec2(da/w*4.,(el-sbase)*180.); float lit=step(.6,h2(floor(wp)+fk*9.+floor(t*.2+h1(fk)*5.)));
        float win=step(.25,fract(wp.x))*step(.35,fract(wp.y));
        col=uC2*.6+mix(uC3,uC4,h1(fk))*lit*win*.9;
        if(el>sbase+H-.006&&abs(da)<.002) col+=vec3(1.,.1,.2)*step(.5,fract(t+fk*.3));}}
  }
  if(ABISSO){
    for(int k=0;k<6;k++){float fk=float(k); float ak=uSeed*6.+fk*1.05, w=.012+h1(fk)*.012, H=.03+h1(fk+2.)*.12;
      float da=adiff(a,ak), top=H-step(.5,h1(fk+5.))*abs(da)*3.;
      if(abs(da)<w&&el<sbase+top&&el>sbase-.03) col=uC2*.7+uC3*smoothstep(.003,0.,abs(da)-w+.003)*.15;}
  }
  if(el<mid){
    float sh=fbm(vec2(a*22.,el*50.)+uSeed*3.,3);
    col=mix(uC2*.62,uC2*.9,sh)+uC3*smoothstep(.004,0.,mid-el)*.25;
  }
  /* ---------- ground plane ---------- */
  if(el<min(mid,-.002)){
    vec3 d=dir; vec2 P=d.xz*(1./-d.y); float dist=length(P);
    vec3 g=uC2;
    if(LUNA){float n=fbm(P*.18+uSeed,4); vec2 cp=P*.22; float cr=noise(cp*1.3);
      float rim=smoothstep(.05,0.,abs(cr-.68))-smoothstep(.1,0.,abs(cr-.6))*.5;
      g=uC2*(.55+n*.6)+rim*.25;}
    else if(MARTE){float n=fbm(P*.1+uSeed,4); float dune=sin(P.x*.9+P.y*.3+n*8.)*.5+.5;
      g=mix(uC2*.6,uC2*1.25,dune)*(.8+n*.4)+uC4*step(.985,h2(floor(P*2.)))*.3;}
    else if(ORIONE){float n=fbm(P*.15+uSeed,4); vec2 tile=floor(P*.5); vec2 fp=fract(P*.5);
      float line=smoothstep(.04,0.,min(min(fp.x,1.-fp.x),min(fp.y,1.-fp.y)));
      float glow=step(.93,h2(tile+uSeed))*(.5+.5*sin(t*1.5+h2(tile)*20.));
      g=uC2*(.6+n*.5)+uC3*line*.12+uC3*glow*(.25+uLevel*.8)*(1.-line);}
    else if(DIST){vec2 gp=P*vec2(.6,.6)+vec2(0.,t*(.4+uBass));
      float gl=smoothstep(.44,.5,abs(fract(gp.x)-.5))+smoothstep(.44,.5,abs(fract(gp.y)-.5));
      g=uC2*.8+mix(uC3,uC4,.5+.5*sin(P.x*.05))*gl*(.35+uBass*1.2)*exp(-dist*.03);}
    else{float cau=pow(abs(sin(fbm(P*.35+t*.07,3)*9.)),6.); float n=fbm(P*.2+uSeed,3);
      g=uC2*(.5+n*.6)+uC3*cau*.25*exp(-dist*.05);}
    float fog=1.-exp(-dist*.04*uWP.z);
    col=mix(g,haze,clamp(fog,0.,1.));
  }

  /* ---------- touch light ---------- */
  vec2 sc=vUv; sc.x*=asp;
  for(int i=0;i<4;i++){vec4 T=uTouch[i]; if(T.z<.5)continue;
    vec2 tp=T.xy; tp.x*=asp; float d=length(sc-tp);
    col+=mix(uC3,uC4,fract(T.w))*(exp(-d*d*120.)*.9+exp(-d*9.)*.25);
    col+=uC4*smoothstep(.006,0.,abs(d-.09-.02*sin(t*8.)))*.5;}
  for(int i=0;i<8;i++){vec4 Rp=uRip[i]; float age=t-Rp.z; if(age<0.||age>3.)continue;
    vec2 tp=Rp.xy; tp.x*=asp; float d=length(sc-tp), r=age*.45;
    vec3 rc=mix(uC3,uC4,Rp.w);
    col+=rc*exp(-pow((d-r)*28.,2.))*exp(-age*1.4)*.9;
    col+=rc*exp(-pow((d-r*.6)*40.,2.))*exp(-age*2.)*.4;}

  /* ---------- post ---------- */
  col+=uC3*uFlash*.6;
  if(DIST) col*=.92+.08*sin(gl_FragCoord.y*1.6);
  vec2 vc=vUv-.5; col*=1.-dot(vc,vc)*.9;
  col+=(h2(vUv*uRes+fract(t)*91.)-.5)*.035;
  col=pow(max(col,0.),vec3(.92));
  col*=1.-uFade;
  gl_FragColor=vec4(col,1.);
}`;
const VS = `attribute vec2 p;varying vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;

let gl, prog, U = {}, canvas, scale = .5;
function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

function init(cv) {
  canvas = cv;
  gl = cv.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return false;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog, i); U[u.name.replace('[0]', '')] = gl.getUniformLocation(prog, u.name); }
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  resize();
  return true;
}
function setQuality(q) { scale = q; resize(); }
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(innerWidth * dpr * scale)), h = Math.max(2, Math.round(innerHeight * dpr * scale));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
const elBuf = new Float32Array(40), elCol = new Float32Array(30), tBuf = new Float32Array(16), rBuf = new Float32Array(32);
function draw(s) {
  resize();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(U.uRes, canvas.width, canvas.height);
  gl.uniform1f(U.uTime, s.time); gl.uniform1f(U.uHead, s.head); gl.uniform1f(U.uElev, s.elev); gl.uniform1f(U.uRoll, s.roll);
  gl.uniform1f(U.uFovY, s.fov); gl.uniform1f(U.uSeed, s.seed); gl.uniform1f(U.uWorld, s.world);
  gl.uniform1f(U.uLevel, s.level); gl.uniform1f(U.uBass, s.bass); gl.uniform1f(U.uFlash, s.flash); gl.uniform1f(U.uFade, s.fade);
  const C = s.colors.map(hex);
  ['uC0', 'uC1', 'uC2', 'uC3', 'uC4'].forEach((k, i) => gl.uniform3fv(U[k], C[i]));
  gl.uniform4fv(U.uWP, s.wp);
  elBuf.fill(0); elCol.fill(0);
  s.els.slice(0, 10).forEach((e, i) => { elBuf.set([e.angle, e.elev, e.level, e.focus], i * 4); elCol.set(hex(e.color), i * 3); });
  gl.uniform4fv(U.uEl, elBuf); gl.uniform3fv(U.uElC, elCol); gl.uniform1f(U.uElN, Math.min(10, s.els.length));
  tBuf.fill(0); s.touches.slice(0, 4).forEach((t, i) => tBuf.set([t.x, t.y, 1, t.hue], i * 4)); gl.uniform4fv(U.uTouch, tBuf);
  rBuf.fill(0); for (let i = 0; i < 8; i++) { const r = s.ripples[i]; rBuf.set(r ? [r.x, r.y, r.t, r.hue] : [0, 0, -99, 0], i * 4); } gl.uniform4fv(U.uRip, rBuf);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
return { init, draw, setQuality, resize };
})();
