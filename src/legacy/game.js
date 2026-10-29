// Original single-file game, moved here unchanged except for the THREE import.
// It gets split into src/core, src/world, src/entities, ... step by step (see docs/ARCHITECTURE.md).
import * as THREE from 'three';

// =====================================================================
//  helpers & noise
// =====================================================================
const PI=Math.PI,TAU=PI*2,V3=THREE.Vector3;
const lerp=(a,b,t)=>a+(b-a)*t,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const wrapPi=a=>{a=(a+PI)%TAU;if(a<0)a+=TAU;return a-PI;};
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const SEED=Math.floor(Math.random()*1e9);
const perm=new Uint8Array(512);
{const r=mulberry32(SEED),p=[...Array(256).keys()];for(let i=255;i>0;i--){const j=Math.floor(r()*(i+1));[p[i],p[j]]=[p[j],p[i]];}for(let i=0;i<512;i++)perm[i]=p[i&255];}
const hash=(i,j)=>perm[perm[i&255]+(j&255)]/255;
function vnoise(x,y){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash(xi,yi),b=hash(xi+1,yi),c=hash(xi,yi+1),d=hash(xi+1,yi+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function fbm(x,y,o=5){let s=0,a=.5,f=1,n=0;for(let i=0;i<o;i++){s+=a*vnoise(x*f,y*f);n+=a;f*=2;a*=.5;}return s/n;}

// =====================================================================
//  infinite world: roads, height, biomes
// =====================================================================
const GRID=260;
const roadX=(k,z)=>k*GRID+30*Math.sin(z/110+k*1.3)+12*Math.sin(z/47+k*2.1);
const roadZ=(k,x)=>k*GRID+30*Math.sin(x/120+k*.7)+12*Math.sin(x/53+k*1.9);
const dRoadX=(k,z)=>30/110*Math.cos(z/110+k*1.3)+12/47*Math.cos(z/47+k*2.1);
const dRoadZ=(k,x)=>30/120*Math.cos(x/120+k*.7)+12/53*Math.cos(x/53+k*1.9);
function distV(x,z){let d=1e9;const k0=Math.round(x/GRID);for(let k=k0-1;k<=k0+1;k++)d=Math.min(d,Math.abs(x-roadX(k,z)));return d*.93;}
function distH(x,z){let d=1e9;const k0=Math.round(z/GRID);for(let k=k0-1;k<=k0+1;k++)d=Math.min(d,Math.abs(z-roadZ(k,x)));return d*.93;}
const roadDist=(x,z)=>Math.min(distV(x,z),distH(x,z));
const roadH=(x,z)=>4+fbm(x/220+40,z/220+40,3)*12;
const biome=(x,z)=>fbm(x/420+300,z/420-200,3);
function rawHeight(x,z){
  const c=fbm(x/200+11,z/200+7,4);
  const m=Math.pow(fbm(x/90+3,z/90+5,4),2.2)*75*smooth(.5,.72,c);
  return (c-.4)*45+fbm(x/28,z/28,3)*5+m;
}
function heightAt(x,z){return lerp(rawHeight(x,z),roadH(x,z),smooth(15,5,roadDist(x,z)));}
const activeRamps=[],activePads=[];
const RAMP_L=9,RAMP_W=7,RAMP_H=3.2;
function groundAt(x,z){
  const rd=roadDist(x,z);
  let g=lerp(rawHeight(x,z),roadH(x,z),smooth(15,5,rd));
  if(rd<6)for(const r of activeRamps){const dx=x-r.x,dz=z-r.z;if(dx*dx+dz*dz>120)continue;
    const u=dx*r.tx+dz*r.tz,v=-dx*r.tz+dz*r.tx;
    if(Math.abs(u)<=RAMP_L&&Math.abs(v)<=RAMP_W/2)g=Math.max(g,r.y+RAMP_H*(1-Math.abs(u)/RAMP_L));}
  return g;
}

// =====================================================================
//  renderer / scene
// =====================================================================
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.domElement.id='gl';
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene=new THREE.Scene();
const SKY=new THREE.Color(0x9fd6f2);
scene.background=SKY;scene.fog=new THREE.Fog(SKY,110,250);
const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.3,900);
scene.add(new THREE.HemisphereLight(0xcfeaff,0x5a7a40,.62));
const sun=new THREE.DirectionalLight(0xfff0d8,1.15);
sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-60,right:60,top:60,bottom:-60,near:1,far:300});
sun.shadow.bias=-.0006;scene.add(sun,sun.target);
const boomLight=new THREE.PointLight(0xff8a3a,0,40,2);scene.add(boomLight);

const M=(c,o={})=>new THREE.MeshStandardMaterial(Object.assign({color:c,flatShading:true,roughness:.85},o));
const Basic=(c,o={})=>new THREE.MeshBasicMaterial(Object.assign({color:c},o));
function mesh(geo,m,x=0,y=0,z=0){const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;return o;}
function canvasTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);return new THREE.CanvasTexture(c);}

// water that follows the player
const waterGeo=new THREE.PlaneGeometry(700,700,70,70);waterGeo.rotateX(-PI/2);
const wBase=Float32Array.from(waterGeo.attributes.position.array);
const water=new THREE.Mesh(waterGeo,M(0x2b8fc2,{transparent:true,opacity:.8,roughness:.2,metalness:.1}));
water.receiveShadow=true;scene.add(water);

// clouds
const clouds=[],cloudMat=M(0xffffff,{roughness:1});
for(let i=0;i<24;i++){const g=new THREE.Group(),n=3+Math.floor(Math.random()*4);
  for(let j=0;j<n;j++){const p=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),cloudMat);p.position.set(j*3.5-n*1.7,Math.random()*1.5,(Math.random()-.5)*3);p.scale.setScalar(3+Math.random()*2.5);g.add(p);}
  g.position.set((Math.random()-.5)*500,60+Math.random()*25,(Math.random()-.5)*500);g.userData.v=2+Math.random()*3;scene.add(g);clouds.push(g);}

// =====================================================================
//  particles (GPU points, custom shader)
// =====================================================================
class FX{
  constructor(max,additive){
    Object.assign(this,{max,i:0});
    const F=n=>new Float32Array(n);
    this.pos=F(max*3);this.col=F(max*4);this.size=F(max);this.vel=F(max*3);this.life=F(max);this.ml=F(max);
    this.s0=F(max);this.s1=F(max);this.a0=F(max);this.g=F(max);this.drag=F(max);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(this.pos,3));
    geo.setAttribute('pcol',new THREE.BufferAttribute(this.col,4));
    geo.setAttribute('size',new THREE.BufferAttribute(this.size,1));
    this.geo=geo;
    this.mat=new THREE.ShaderMaterial({uniforms:{uScale:{value:800}},transparent:true,depthWrite:false,
      blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,
      vertexShader:`attribute float size;attribute vec4 pcol;varying vec4 vC;
        void main(){vC=pcol;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*uScale/max(.1,-mv.z);gl_Position=projectionMatrix*mv;}`.replace('void main','uniform float uScale;void main'),
      fragmentShader:`varying vec4 vC;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vC.rgb,vC.a*smoothstep(.5,.08,d));}`});
    const pts=new THREE.Points(geo,this.mat);pts.frustumCulled=false;scene.add(pts);
  }
  spawn(x,y,z,vx,vy,vz,life,s0,s1,hex,a=1,g=0,drag=0){
    const i=this.i;this.i=(i+1)%this.max;const c=_c.setHex(hex);
    this.pos.set([x,y,z],i*3);this.vel.set([vx,vy,vz],i*3);this.col.set([c.r,c.g,c.b,a],i*4);
    this.life[i]=this.ml[i]=life;this.s0[i]=s0;this.s1[i]=s1;this.a0[i]=a;this.g[i]=g;this.drag[i]=drag;
  }
  update(dt){
    const{pos,vel,life,ml,size,col}=this;
    for(let i=0;i<this.max;i++){
      if(life[i]<=0)continue;
      life[i]-=dt;if(life[i]<=0){size[i]=0;continue;}
      const t=1-life[i]/ml[i],dr=1-this.drag[i]*dt;
      vel[i*3]*=dr;vel[i*3+1]=vel[i*3+1]*dr-this.g[i]*dt;vel[i*3+2]*=dr;
      pos[i*3]+=vel[i*3]*dt;pos[i*3+1]+=vel[i*3+1]*dt;pos[i*3+2]+=vel[i*3+2]*dt;
      size[i]=this.s0[i]+(this.s1[i]-this.s0[i])*t;col[i*4+3]=this.a0[i]*(1-t*t);
    }
    this.geo.attributes.position.needsUpdate=this.geo.attributes.pcol.needsUpdate=this.geo.attributes.size.needsUpdate=true;
  }
}
const _c=new THREE.Color();
const glow=new FX(5000,true),smoke=new FX(2500,false);
const rnd=(a=1)=>(Math.random()*2-1)*a;
function burst(x,y,z,n,speed,life,s0,s1,colors,g=0,drag=1.5,sys=glow,a=1){
  for(let i=0;i<n;i++){const v=new V3(rnd(),rnd(),rnd()).normalize().multiplyScalar(speed*(.4+Math.random()*.6));
    sys.spawn(x,y,z,v.x,v.y,v.z,life*(.6+Math.random()*.6),s0,s1,colors[i%colors.length],a,g,drag);}
}
// shockwave rings
const rings=[];
const ringGeo=new THREE.RingGeometry(.85,1,40).rotateX(-PI/2);
function shockRing(x,y,z,r,hex){const m=new THREE.Mesh(ringGeo,Basic(hex,{transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  m.position.set(x,y,z);m.userData={t:0,r};scene.add(m);rings.push(m);}

// =====================================================================
//  audio (WebAudio synth – no files)
// =====================================================================
let AC=null,master,engOsc,engGain,engFilt,muted=false,noiseBuf;
function initAudio(){
  if(AC)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){return;}
  master=AC.createGain();master.gain.value=.45;master.connect(AC.destination);
  engOsc=AC.createOscillator();engOsc.type='sawtooth';engFilt=AC.createBiquadFilter();engFilt.type='lowpass';engFilt.frequency.value=500;
  engGain=AC.createGain();engGain.gain.value=0;engOsc.connect(engFilt).connect(engGain).connect(master);engOsc.start();
  noiseBuf=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
}
function tone(f,dur,type='square',vol=.12,slide=1,delay=0){
  if(!AC||muted)return;const t=AC.currentTime+delay,o=AC.createOscillator(),g=AC.createGain();
  o.type=type;o.frequency.setValueAtTime(f,t);if(slide!==1)o.frequency.exponentialRampToValueAtTime(Math.max(20,f*slide),t+dur);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g).connect(master);o.start(t);o.stop(t+dur+.02);
}
function noise(dur,vol=.3,freq=1000,type='lowpass'){
  if(!AC||muted)return;const t=AC.currentTime,s=AC.createBufferSource(),f=AC.createBiquadFilter(),g=AC.createGain();
  s.buffer=noiseBuf;f.type=type;f.frequency.setValueAtTime(freq,t);f.frequency.exponentialRampToValueAtTime(Math.max(40,freq*.2),t+dur);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);s.connect(f).connect(g).connect(master);s.start(t);s.stop(t+dur);
}
const SFX={
  gem(){tone(880,.09,'triangle',.14);tone(1320,.14,'triangle',.12,1,.07);},
  blaster(){tone(1100,.09,'square',.05,.35);},
  scatter(){noise(.18,.25,2500);tone(300,.1,'square',.05,.5);},
  rocket(){tone(180,.35,'sawtooth',.09,.5);noise(.3,.15,900);},
  boom(v=1){noise(.9,.55*v,900);tone(70,.6,'sine',.35*v,.4);},
  hit(){tone(260,.06,'square',.06,.6);},
  hurt(){tone(160,.18,'sawtooth',.12,.5);},
  crash(){noise(.5,.4,600);tone(90,.35,'square',.1,.5);},
  nitro(){noise(.55,.22,3000,'bandpass');},
  pad(){tone(500,.3,'sine',.12,2.5);},
  level(){[523,659,784,1046].forEach((f,i)=>tone(f,.18,'triangle',.13,1,i*.09));},
  trick(){tone(660,.1,'triangle',.1);tone(990,.16,'triangle',.1,1,.08);},
  challenge(){[392,523,659,784,1046].forEach((f,i)=>tone(f,.16,'square',.07,1,i*.08));},
  fail(){tone(300,.25,'sawtooth',.08,.6);tone(200,.35,'sawtooth',.08,.6,.2);},
  orb(){tone(420,.15,'sine',.05,.6);}
};

// =====================================================================
//  shared geometry / materials
// =====================================================================
const G={trunk:new THREE.CylinderGeometry(.25,.4,2.2,6),blob:new THREE.IcosahedronGeometry(1.6,0),cone:new THREE.ConeGeometry(1.6,2.6,7),
  rock:new THREE.DodecahedronGeometry(1.3,0),cactus:new THREE.CylinderGeometry(.35,.4,3.2,7),arm:new THREE.CylinderGeometry(.22,.22,1.2,6),
  box:new THREE.BoxGeometry(1,1,1),gem:new THREE.OctahedronGeometry(.7,0),barrel:new THREE.CylinderGeometry(.6,.6,1.3,12),band:new THREE.CylinderGeometry(.62,.62,.12,12),
  tcone:new THREE.ConeGeometry(.38,1,10),sph:new THREE.SphereGeometry(1,12,10)};
const MAT={trunk:M(0x7a5232),white:M(0xffffff),rock:M(0x8a8d91),cactus:M(0x4f9a4a),
  gem:M(0x46e3ff,{emissive:0x1a9fff,emissiveIntensity:.9,roughness:.2,metalness:.3}),
  crate:new THREE.MeshStandardMaterial({map:canvasTex(64,64,(g,w,h)=>{g.fillStyle='#b9853f';g.fillRect(0,0,w,h);g.strokeStyle='#6b4520';g.lineWidth=2;for(let y=16;y<h;y+=16){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}g.lineWidth=7;g.strokeRect(3,3,w-6,h-6);g.beginPath();g.moveTo(5,5);g.lineTo(w-5,h-5);g.stroke();}),roughness:.9}),
  barrel:M(0xd8322a,{roughness:.5,metalness:.3}),band:M(0xf2f2f2),cone:M(0xff7a1a),coneBase:M(0x222222),
  ramp:new THREE.MeshStandardMaterial({map:canvasTex(64,64,(g,w,h)=>{g.fillStyle='#f2a33a';g.fillRect(0,0,w,h);g.fillStyle='#222';for(let i=-64;i<128;i+=20){g.beginPath();g.moveTo(i,0);g.lineTo(i+10,0);g.lineTo(i-54,h);g.lineTo(i-64,h);g.fill();}}),flatShading:true}),
  pad:new THREE.MeshBasicMaterial({transparent:true,map:canvasTex(64,96,(g,w,h)=>{g.fillStyle='rgba(20,200,255,.85)';g.fillRect(0,0,w,h);g.strokeStyle='#fff';g.lineWidth=7;g.lineJoin='round';for(let y=18;y<h;y+=28){g.beginPath();g.moveTo(12,y+14);g.lineTo(32,y-4);g.lineTo(52,y+14);g.stroke();}})}),
  droneBody:M(0x2b2f38,{metalness:.6,roughness:.35}),droneGlow:Basic(0xff2a3a),orb:Basic(0xff3355,{transparent:true,blending:THREE.AdditiveBlending}),
};
MAT.ramp.map.wrapS=MAT.ramp.map.wrapT=THREE.RepeatWrapping;

// =====================================================================
//  chunk streaming
// =====================================================================
const CH=64,SEG=24,VIEW=4;
const chunks=new Map(),entities=[];
const ckey=(cx,cz)=>cx+','+cz;
const C={road:new THREE.Color(0x4b4f56),shoulder:new THREE.Color(0xcbb48a),sand:new THREE.Color(0xe6d29a),under:new THREE.Color(0xb79f6c),
  d1:new THREE.Color(0xe2b86f),d2:new THREE.Color(0xd49a5a),g1:new THREE.Color(0x6abf4b),g2:new THREE.Color(0x4c9a38),f1:new THREE.Color(0x3f8a3a),f2:new THREE.Color(0x2f6e30),
  rock:new THREE.Color(0x8b8378),snow:new THREE.Color(0xf4f7fb)};
const _a=new THREE.Color(),_b=new THREE.Color(),_d=new THREE.Color();
function terrainColor(x,y,z,col){
  const rd=roadDist(x,z);
  if(y>.5&&rd<4.6){col.copy(C.road);return;}
  if(y>.5&&rd<6.2){col.copy(C.shoulder);return;}
  if(y<.4){col.copy(C.under);return;}
  if(y<1.8){col.copy(C.sand);return;}
  const b=biome(x,z),n=vnoise(x/9,z/9);
  _d.copy(C.d1).lerp(C.d2,n);_a.copy(C.g1).lerp(C.g2,n);_b.copy(C.f1).lerp(C.f2,n);
  col.copy(_d).lerp(_a,smooth(.36,.42,b)).lerp(_b,smooth(.58,.64,b));
  if(y>22)col.lerp(C.rock,smooth(22,27,y));
  if(y>34)col.lerp(C.snow,smooth(34,37,y));
}
const UP=new V3(0,1,0);
function chunkAt(x,z){return chunks.get(ckey(Math.floor(x/CH),Math.floor(z/CH)));}
function nearChunks(x,z){const cx=Math.floor(x/CH),cz=Math.floor(z/CH),out=[];
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const c=chunks.get(ckey(cx+i,cz+j));if(c)out.push(c);}return out;}

function buildChunk(cx,cz){
  const x0=cx*CH,z0=cz*CH,rng=mulberry32(SEED^Math.imul(cx,73856093)^Math.imul(cz,19349663));
  const ch={cx,cz,obs:[],ramps:[],pads:[],meshes:[]};
  // terrain
  let geo=new THREE.PlaneGeometry(CH,CH,SEG,SEG);geo.rotateX(-PI/2);geo.translate(x0+CH/2,0,z0+CH/2);
  const p=geo.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,heightAt(p.getX(i),p.getZ(i)));
  geo=geo.toNonIndexed();
  const pa=geo.attributes.position.array,cols=new Float32Array(pa.length),col=new THREE.Color();
  for(let i=0;i<pa.length;i+=9){
    terrainColor((pa[i]+pa[i+3]+pa[i+6])/3,(pa[i+1]+pa[i+4]+pa[i+7])/3,(pa[i+2]+pa[i+5]+pa[i+8])/3,col);
    col.multiplyScalar(.95+rng()*.07);for(let k=0;k<3;k++)cols.set([col.r,col.g,col.b],i+k*3);
  }
  geo.setAttribute('color',new THREE.BufferAttribute(cols,3));geo.computeVertexNormals();
  const tm=new THREE.Mesh(geo,terrainMat);tm.receiveShadow=true;scene.add(tm);ch.meshes.push(tm);ch.terrain=tm;

  // scenery (instanced per chunk)
  const parts={};
  const add=(k,g,m,mx,c)=>{const q=parts[k]||(parts[k]={g,m,l:[],c:[]});q.l.push(mx);if(c)q.c.push(c);};
  const T=(x,y,z)=>new THREE.Matrix4().makeTranslation(x,y,z),S=(a,b=a,c=a)=>new THREE.Matrix4().makeScale(a,b,c);
  const base=(x,y,z,s)=>new THREE.Matrix4().compose(new V3(x,y,z),new THREE.Quaternion().setFromAxisAngle(UP,rng()*TAU),new V3(s,s,s));
  for(let t=0;t<85;t++){
    const x=x0+rng()*CH,z=z0+rng()*CH,y=heightAt(x,z),rd=roadDist(x,z);
    if(rd<9||y<1.8)continue;
    const b=biome(x,z),roll=rng(),s=.8+rng()*.6;
    if(y>30){if(roll<.18){const m=base(x,y,z,s);add('trunk',G.trunk,MAT.trunk,m.clone().multiply(T(0,1.1,0)));
        [[2.4,1],[3.6,.8],[4.7,.58]].forEach(([yy,k])=>add('pine',G.cone,MAT.white,m.clone().multiply(T(0,yy,0)).multiply(S(k)),new THREE.Color(y>36?0xe8f0f4:0x2f6e43)));ch.obs.push({x,z,r:.6*s,top:y+6});}
      else if(roll<.3){add('rock',G.rock,MAT.rock,new THREE.Matrix4().compose(new V3(x,y+.2,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(),rng()*6,0)),new V3(s*1.4,s,s*1.2)));ch.obs.push({x,z,r:1.4*s,top:y+2});}
      continue;}
    if(b<.4){ // desert
      if(roll<.12){const m=base(x,y,z,s);add('cactus',G.cactus,MAT.cactus,m.clone().multiply(T(0,1.6,0)));
        add('cactus',G.arm,MAT.cactus,m.clone().multiply(T(.55,1.9,0)));add('cactus',G.arm,MAT.cactus,m.clone().multiply(T(-.5,1.4,0)));ch.obs.push({x,z,r:.5*s,top:y+3.5});}
      else if(roll<.18){add('rock',G.rock,MAT.rock,new THREE.Matrix4().compose(new V3(x,y+.2,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(),rng()*6,0)),new V3(s*1.3,s*.8,s)));ch.obs.push({x,z,r:1.3*s,top:y+2});}
    }else{
      const forest=b>.6,pTree=forest?.85:.3;
      if(roll<pTree){const m=base(x,y,z,s);add('trunk',G.trunk,MAT.trunk,m.clone().multiply(T(0,1.1,0)));
        if(forest&&rng()<.6)[[2.4,1],[3.6,.8],[4.7,.58]].forEach(([yy,k])=>add('pine',G.cone,MAT.white,m.clone().multiply(T(0,yy,0)).multiply(S(k)),new THREE.Color(0x2f6e43)));
        else{const c=new THREE.Color([0x4caf50,0x5dbb3f,0x3e9a48,0x7cc142,0x8bc34a][Math.floor(rng()*5)]);
          add('leaf',G.blob,MAT.white,m.clone().multiply(T(0,3.2,0)),c);add('leaf',G.blob,MAT.white,m.clone().multiply(T(.7,2.6,.3)).multiply(S(.65)),c);}
        ch.obs.push({x,z,r:.6*s,top:y+6});}
      else if(roll<pTree+.05){add('rock',G.rock,MAT.rock,new THREE.Matrix4().compose(new V3(x,y+.2,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(),rng()*6,0)),new V3(s*1.3,s*.8,s)));ch.obs.push({x,z,r:1.3*s,top:y+2});}
    }
  }
  for(const q of Object.values(parts)){const im=new THREE.InstancedMesh(q.g,q.m,q.l.length);
    q.l.forEach((m,i)=>{im.setMatrixAt(i,m);if(q.c.length)im.setColorAt(i,q.c[i]);});
    im.castShadow=im.receiveShadow=true;scene.add(im);ch.meshes.push(im);}

  // road features
  const feat=(x,z,tx,tz)=>roadFeature(ch,rng,x,z,tx,tz);
  for(let k=Math.floor((x0-60)/GRID);k<=Math.ceil((x0+CH+60)/GRID);k++)
    for(let z=z0+4;z<z0+CH;z+=8){const x=roadX(k,z);if(x<x0||x>=x0+CH||distH(x,z)<22)continue;const d=dRoadX(k,z),l=Math.hypot(d,1);feat(x,z,d/l,1/l);}
  for(let k=Math.floor((z0-60)/GRID);k<=Math.ceil((z0+CH+60)/GRID);k++)
    for(let x=x0+4;x<x0+CH;x+=8){const z=roadZ(k,x);if(z<z0||z>=z0+CH||distV(x,z)<22)continue;const d=dRoadZ(k,x),l=Math.hypot(1,d);feat(x,z,1/l,d/l);}

  // wandering drones (more the further you go)
  const far=Math.hypot(x0,z0);
  if(Math.hypot(x0+CH/2-spawnPt.x,z0+CH/2-spawnPt.z)>90&&rng()<.1+Math.min(.25,far/4000))
    addEntity(ch,'drone',x0+rng()*CH,z0+rng()*CH);
  chunks.set(ckey(cx,cz),ch);
}
function roadFeature(ch,rng,x,z,tx,tz){
  const r=rng(),nx=-tz,nz=tx,y=heightAt(x,z);
  if(r<.05){
    if(ch.ramps.some(q=>Math.hypot(q.x-x,q.z-z)<50)||Math.hypot(x-spawnPt.x,z-spawnPt.z)<40)return;
    const s=new THREE.Shape();s.moveTo(-RAMP_L,0);s.lineTo(RAMP_L,0);s.lineTo(0,RAMP_H);s.lineTo(-RAMP_L,0);
    const g=new THREE.ExtrudeGeometry(s,{depth:RAMP_W,bevelEnabled:false});g.translate(0,0,-RAMP_W/2);
    const m=mesh(g,MAT.ramp);m.position.set(x,y-.05,z);m.rotation.y=Math.atan2(-tz,tx);scene.add(m);ch.meshes.push(m);
    const rp={x,z,tx,tz,y};ch.ramps.push(rp);activeRamps.push(rp);
    [[1,4],[2.3,5.2],[3.6,4]].forEach(([u,h])=>{const s2=u*5;addEntity(ch,'gem',x+tx*s2,z+tz*s2,y+RAMP_H+h);addEntity(ch,'gem',x-tx*s2,z-tz*s2,y+RAMP_H+h);});
  }else if(r<.085){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(4,6).rotateX(-PI/2),MAT.pad);m.position.set(x,y+.08,z);m.rotation.y=Math.atan2(tx,tz);
    m.receiveShadow=true;scene.add(m);ch.meshes.push(m);const pd={x,z,y,cd:0,m};ch.pads.push(pd);activePads.push(pd);
  }else if(r<.3){const o=(rng()-.5)*5;addEntity(ch,'gem',x+nx*o,z+nz*o);}
  else if(r<.33){const o=(rng()-.5)*4;for(let i=-1;i<=1;i++)addEntity(ch,'cone',x+nx*(o+i*1.4),z+nz*(o+i*1.4));}
  else if(r<.355){const o=(rng()-.5)*5;addEntity(ch,'crate',x+nx*o,z+nz*o);}
  else if(r<.37){const o=(rng()-.5)*5;addEntity(ch,'barrel',x+nx*o,z+nz*o);}
  else if(r<.42){const side=rng()<.5?-1:1,o=side*(7+rng()*4),n=3+Math.floor(rng()*3);
    for(let i=0;i<n;i++){const a=x+nx*o+(rng()-.5)*4,b=z+nz*o+(rng()-.5)*4;addEntity(ch,rng()<.3?'barrel':'crate',a,b);}}
}
function unloadChunk(ch){
  ch.meshes.forEach(m=>{scene.remove(m);if(m===ch.terrain||m.geometry.type==='ExtrudeGeometry'||m.geometry.type==='PlaneGeometry'&&m.material===MAT.pad)m.geometry.dispose();if(m.isInstancedMesh&&m.dispose)m.dispose();});
  ch.ramps.forEach(r=>activeRamps.splice(activeRamps.indexOf(r),1));
  ch.pads.forEach(r=>activePads.splice(activePads.indexOf(r),1));
  for(const e of entities)if(e.ch===ch&&e.alive){e.alive=false;scene.remove(e.mesh);}
  chunks.delete(ckey(ch.cx,ch.cz));
}
const terrainMat=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.95});
function streamChunks(px,pz,budget){
  const pcx=Math.floor(px/CH),pcz=Math.floor(pz/CH),need=[];
  for(let i=-VIEW;i<=VIEW;i++)for(let j=-VIEW;j<=VIEW;j++){if(i*i+j*j>VIEW*VIEW+2)continue;if(!chunks.has(ckey(pcx+i,pcz+j)))need.push([pcx+i,pcz+j,i*i+j*j]);}
  need.sort((a,b)=>a[2]-b[2]);
  for(let n=0;n<Math.min(budget,need.length);n++)buildChunk(need[n][0],need[n][1]);
  for(const ch of [...chunks.values()])if(Math.abs(ch.cx-pcx)>VIEW+1||Math.abs(ch.cz-pcz)>VIEW+1)unloadChunk(ch);
}

// =====================================================================
//  entities: gems, crates, barrels, cones, drones
// =====================================================================
function makeDrone(){
  const g=new THREE.Group();g.add(mesh(new THREE.SphereGeometry(.75,10,8),MAT.droneBody));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.15,.1,6,24),MAT.droneGlow);ring.rotation.x=PI/2;g.add(ring);
  const eye=new THREE.Mesh(new THREE.SphereGeometry(.24,8,6),MAT.droneGlow);eye.position.set(0,0,.68);g.add(eye);
  const rotors=[];[[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([a,b])=>{const arm=mesh(G.box,MAT.droneBody,a*.7,.15,b*.7);arm.scale.set(.15,.12,.15);g.add(arm);
    const r=mesh(G.box,MAT.droneBody,a*1.1,.32,b*1.1);r.scale.set(1.1,.04,.16);g.add(r);rotors.push(r);});
  g.userData={eye,rotors};return g;
}
function addEntity(ch,type,x,z,yOverride){
  const gy=groundAt(x,z);if(gy<.5&&type!=='drone')return null;
  let m,hp=1,r=.8,y=gy;
  if(type==='gem'){m=mesh(G.gem,MAT.gem);y=yOverride??gy+1.4;r=1;}
  else if(type==='crate'){m=mesh(G.box,MAT.crate);m.scale.setScalar(1.7);m.position.y=.85;hp=30;r=1.1;}
  else if(type==='barrel'){m=new THREE.Group();m.add(mesh(G.barrel,MAT.barrel,0,.65,0));m.add(mesh(G.band,MAT.band,0,.35,0));m.add(mesh(G.band,MAT.band,0,.95,0));hp=15;r=.8;}
  else if(type==='cone'){m=new THREE.Group();m.add(mesh(G.tcone,MAT.cone,0,.5,0));const b=mesh(G.box,MAT.coneBase,0,.04,0);b.scale.set(.8,.08,.8);m.add(b);hp=1;r=.45;}
  else if(type==='drone'){m=makeDrone();y=gy+7;hp=50;r=1.4;}
  const holder=new THREE.Group();holder.add(m);holder.position.set(x,y,z);holder.rotation.y=Math.random()*TAU;scene.add(holder);
  const e={type,mesh:holder,inner:m,x,y,z,hp,maxHp:hp,r,ch,alive:true,t:Math.random()*10,cool:2+Math.random()*2,ang:Math.random()*TAU,fuse:0,hitFlash:0};
  entities.push(e);return e;
}
function spawnNear(type,n,minD=35,maxD=70){
  const P=playerPos();
  for(let i=0;i<n;i++){const a=P.h+(Math.random()-.5)*1.6,d=minD+Math.random()*(maxD-minD),x=P.x+Math.sin(a)*d,z=P.z+Math.cos(a)*d,c=chunkAt(x,z);
    if(c)addEntity(c,type,x,z);}
}

// debris
const debris=[];
function addDebris(x,y,z,mat,n,size,power){
  for(let i=0;i<n;i++){const d=mesh(G.box,mat,x+rnd(.5),y+rnd(.5),z+rnd(.5));d.scale.setScalar(size*(.5+Math.random()*.6));scene.add(d);
    debris.push({m:d,vx:rnd(power),vy:power*(.5+Math.random()),vz:rnd(power),ax:rnd(8),az:rnd(8),life:2+Math.random()});}
}

// =====================================================================
//  player: character + motorcycle
// =====================================================================
const skin=M(0xf1c27d),shirt=M(0xe2483d),pants=M(0x2c4a7a),dark=M(0x222428),hairM=M(0x3b2416);
function limb(w,h,d,m){const pv=new THREE.Group();pv.add(mesh(new THREE.BoxGeometry(w,h,d),m,0,-h/2,0));return pv;}
const person=new THREE.Group();
const torso=mesh(new THREE.BoxGeometry(.8,.95,.45),shirt,0,1.5,0);person.add(torso);
person.add(mesh(new THREE.BoxGeometry(.55,.55,.55),skin,0,2.27,0));
const hair=mesh(new THREE.BoxGeometry(.6,.18,.6),hairM,0,2.55,-.02);person.add(hair);
const helmet=mesh(new THREE.SphereGeometry(.42,10,8,0,TAU,0,PI/2),M(0xffcc33,{roughness:.4}),0,2.35,0);helmet.visible=false;person.add(helmet);
[-.13,.13].forEach(x=>person.add(mesh(new THREE.BoxGeometry(.08,.08,.02),dark,x,2.33,.28)));
const legL=limb(.32,1,.34,pants),legR=limb(.32,1,.34,pants);legL.position.set(-.2,1.03,0);legR.position.set(.2,1.03,0);
const armL=limb(.22,.9,.22,shirt),armR=limb(.22,.9,.22,shirt);armL.position.set(-.52,1.92,0);armR.position.set(.52,1.92,0);
[legL,legR,armL,armR].forEach(l=>person.add(l));
armL.add(mesh(new THREE.BoxGeometry(.2,.2,.2),skin,0,-.95,0));
const gun=new THREE.Group();gun.add(mesh(new THREE.BoxGeometry(.16,.2,.7),dark,0,-.95,.25));gun.add(mesh(new THREE.BoxGeometry(.1,.1,.3),M(0x55e8ff,{emissive:0x22aaff}),0,-.92,.65));armR.add(gun);
[legL,legR].forEach(l=>l.add(mesh(new THREE.BoxGeometry(.34,.18,.5),dark,0,-1,.08)));
scene.add(person);

const bike=new THREE.Group();bike.rotation.order='YXZ';
const bodyM=M(0x1565d8,{roughness:.35,metalness:.3}),chrome=M(0xcfd6de,{roughness:.2,metalness:.8}),tyre=M(0x1a1a1a);
const wheels=[];
[1.05,-1.05].forEach(z=>{const sp=new THREE.Group();sp.position.set(0,.62,z);
  const t=mesh(new THREE.TorusGeometry(.5,.16,8,18),tyre);t.rotation.y=PI/2;sp.add(t);
  const hub=mesh(new THREE.CylinderGeometry(.2,.2,.2,8),chrome);hub.rotation.z=PI/2;sp.add(hub);
  for(let k=0;k<3;k++){const s=mesh(new THREE.BoxGeometry(.06,.85,.06),chrome);s.rotation.x=k*PI/3;sp.add(s);}
  bike.add(sp);wheels.push(sp);});
bike.add(mesh(new THREE.BoxGeometry(.28,.28,1.7),dark,0,1.0,0));
bike.add(mesh(new THREE.BoxGeometry(.55,.5,.65),chrome,0,.78,.05));
bike.add(mesh(new THREE.BoxGeometry(.58,.42,.75),bodyM,0,1.3,.38));
bike.add(mesh(new THREE.BoxGeometry(.46,.18,.85),dark,0,1.25,-.42));
const tail=mesh(new THREE.BoxGeometry(.4,.25,.5),bodyM,0,1.3,-.95);tail.rotation.x=-.25;bike.add(tail);
const fork=mesh(new THREE.CylinderGeometry(.07,.07,1.05,6),chrome,0,1.12,.95);fork.rotation.x=-.25;bike.add(fork);
const bar=mesh(new THREE.CylinderGeometry(.05,.05,1.1,6),chrome,0,1.65,.78);bar.rotation.z=PI/2;bike.add(bar);
bike.add(mesh(new THREE.SphereGeometry(.18,10,8),M(0xfff6c0,{emissive:0xfff2a0,emissiveIntensity:1}),0,1.42,1.18));
const pipe=mesh(new THREE.CylinderGeometry(.09,.11,1.1,8),chrome,.33,.7,-.55);pipe.rotation.x=PI/2+.15;bike.add(pipe);
bike.add(mesh(new THREE.BoxGeometry(.32,.06,.7),bodyM,0,1.22,1.1));
const flame=new THREE.Mesh(new THREE.ConeGeometry(.17,1,8),Basic(0x66ccff,{transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false}));
flame.rotation.x=-PI/2;flame.position.set(.33,.62,-1.6);flame.scale.set(1,.01,1);bike.add(flame);
const seatSlot=new THREE.Group();seatSlot.position.set(0,.3,-.35);bike.add(seatSlot);
scene.add(bike);

// =====================================================================
//  stats, skills, weapons, challenges
// =====================================================================
const ST={top:30,accel:17,nitroMax:100,nitroRegen:2,grip:1.9,hpMax:100,fire:1,dmg:1,magnet:3,xpMul:1};
const UPGRADES=[
  {t:'Engine Tune',d:'+10% top speed and acceleration',f:()=>{ST.top*=1.1;ST.accel*=1.1;}},
  {t:'Bigger Tank',d:'+40 nitro capacity',f:()=>{ST.nitroMax+=40;S.nitro=ST.nitroMax;}},
  {t:'Nitro Recycler',d:'Nitro refills 2x faster',f:()=>{ST.nitroRegen*=2;}},
  {t:'Grip Tires',d:'+15% steering',f:()=>{ST.grip*=1.15;}},
  {t:'Armor Plating',d:'+30 max health, full heal',f:()=>{ST.hpMax+=30;S.hp=ST.hpMax;}},
  {t:'Rapid Fire',d:'+25% fire rate',f:()=>{ST.fire*=1.25;}},
  {t:'Hollow Points',d:'+30% weapon damage',f:()=>{ST.dmg*=1.3;}},
  {t:'Gem Magnet',d:'Pull gems from 60% further away',f:()=>{ST.magnet*=1.6;}},
  {t:'Scholar',d:'+20% XP from everything',f:()=>{ST.xpMul*=1.2;}},
];
const WEAPONS=[
  {name:'Blaster',rate:8,dmg:20,speed:130,life:1.1,color:0x55e8ff,pellets:1,spread:.012,sfx:'blaster'},
  {name:'Scatter',rate:1.7,dmg:11,speed:105,life:.45,color:0xffe066,pellets:8,spread:.12,sfx:'scatter'},
  {name:'Rocket',rate:1.1,dmg:70,speed:62,life:2.5,color:0xff7a2e,pellets:1,spread:0,splash:8,sfx:'rocket'},
];
const S={hp:100,nitro:100,xp:0,level:1,score:0,gems:0,dist:0,weapon:0,fireCd:0,lastHurt:-9,combo:0,comboT:0,pendingLevels:0,paused:false,dead:false};
const xpNeed=()=>350+S.level*250;
const CHALLENGES=[
  {id:'gem',mode:'sum',txt:n=>`Collect ${n} gems`,n:()=>6+Math.floor(Math.random()*5),time:40},
  {id:'air',mode:'max',txt:n=>`Stay airborne ${n}s in one jump`,n:()=>1.4,time:50,fmt:v=>v.toFixed(1)+'s'},
  {id:'speed',mode:'max',txt:n=>`Hit ${n} km/h`,n:()=>130+10*Math.floor(Math.random()*4),time:30},
  {id:'crate',mode:'sum',txt:n=>`Smash ${n} crates`,n:()=>4+Math.floor(Math.random()*3),time:45,setup:n=>spawnNear('crate',n+2)},
  {id:'drone',mode:'sum',txt:n=>`Destroy ${n} drones`,n:()=>2+Math.floor(Math.random()*2),time:60,setup:n=>spawnNear('drone',n,40,80)},
  {id:'flip',mode:'sum',txt:n=>`Land ${n} flip${n>1?'s':''}`,n:()=>1+Math.floor(Math.random()*2),time:60},
  {id:'barrel',mode:'sum',txt:n=>`Blow up ${n} barrels`,n:()=>3,time:45,setup:n=>spawnNear('barrel',n+2)},
  {id:'dist',mode:'sum',txt:n=>`Ride ${n} m`,n:()=>500+100*Math.floor(Math.random()*4),time:40,fmt:v=>Math.floor(v)+' m'},
];
let CH_STATE=null,chCooldown=6;
function notify(id,v=1){
  if(!CH_STATE||CH_STATE.done||CH_STATE.def.id!==id)return;
  CH_STATE.prog=CH_STATE.def.mode==='max'?Math.max(CH_STATE.prog,v):CH_STATE.prog+v;
  if(CH_STATE.prog>=CH_STATE.n){CH_STATE.done=true;SFX.challenge();banner('CHALLENGE COMPLETE','+300 XP · nitro refilled','#7cffb2');addXP(300);S.nitro=ST.nitroMax;
    flashScreen('#7cffb2',.35);const P=playerPos();burst(P.x,P.y+2,P.z,80,18,1.2,.6,.1,[0x7cffb2,0xffffff,0x3cc8ff],6);chCooldown=8;}
}
function newChallenge(){const def=CHALLENGES[Math.floor(Math.random()*CHALLENGES.length)],n=def.n();
  CH_STATE={def,n,prog:0,t:def.time,done:false};def.setup&&def.setup(n);SFX.trick();banner('NEW CHALLENGE',def.txt(n),'#3cc8ff');}

// =====================================================================
//  state
// =====================================================================
const spawnPt={x:roadX(0,0),z:0};
const B={x:spawnPt.x,z:spawnPt.z,y:0,h:Math.atan2(dRoadX(0,0),1),moveH:0,v:0,vy:0,lean:0,pitch:0,pitchV:0,air:false,airT:0,lastG:0,wheel:0,flipAcc:0,spinAcc:0,pad:0};
B.moveH=B.h;
const W={x:spawnPt.x+Math.cos(B.h)*2.5,z:spawnPt.z-Math.sin(B.h)*2.5-.8,y:0,h:B.h,vy:0,ground:true,phase:0,amt:0};
let riding=false,camYaw=0,zoom=1,shake=0,fovKick=0,boostAmt=0,mouseFire=false,helpOn=true;
function playerPos(){return riding?{x:B.x,y:B.y,z:B.z,h:B.moveH,v:B.v}:{x:W.x,y:W.y,z:W.z,h:W.h,v:0};}

// =====================================================================
//  input
// =====================================================================
const keys=new Set();
const GAME_KEYS=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyE','KeyR','KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','KeyF','KeyQ','KeyM','KeyH','Digit1','Digit2','Digit3'];
addEventListener('keydown',e=>{initAudio();if(GAME_KEYS.includes(e.code))e.preventDefault();if(!keys.has(e.code))onPress(e.code);keys.add(e.code);});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{keys.clear();mouseFire=false;});
const K=()=>({up:keys.has('ArrowUp')||keys.has('KeyW'),down:keys.has('ArrowDown')||keys.has('KeyS'),
  left:keys.has('ArrowLeft')||keys.has('KeyA'),right:keys.has('ArrowRight')||keys.has('KeyD'),
  shift:keys.has('ShiftLeft')||keys.has('ShiftRight'),space:keys.has('Space'),fire:keys.has('KeyF')||mouseFire});
function onPress(code){
  if(S.paused){const i=['Digit1','Digit2','Digit3'].indexOf(code);if(i>=0)pickCard(i);return;}
  if(code==='KeyE')toggleRide();
  if(code==='KeyR')respawn();
  if(code==='KeyQ')setWeapon((S.weapon+1)%WEAPONS.length);
  const d=['Digit1','Digit2','Digit3'].indexOf(code);if(d>=0)setWeapon(d);
  if(code==='KeyM'){muted=!muted;banner(muted?'MUTED':'SOUND ON','','#fff');}
  if(code==='KeyH'){helpOn=!helpOn;document.getElementById('help').style.display=helpOn?'':'none';}
}
function setWeapon(i){S.weapon=i;document.getElementById('weapon').textContent=WEAPONS[i].name;tone(600+i*200,.08,'triangle',.08);}
function mount(){riding=true;seatSlot.add(person);person.position.set(0,0,0);person.rotation.set(0,0,0);helmet.visible=true;hair.visible=false;}
function toggleRide(){
  if(!riding&&Math.hypot(W.x-B.x,W.z-B.z)<3.5){mount();tone(120,.4,'sawtooth',.1,2);}
  else if(riding){
    for(const side of [1,-1]){const rx=Math.cos(B.moveH)*side,rz=-Math.sin(B.moveH)*side,nx=B.x-rx*2,nz=B.z-rz*2;
      if(!blocked(nx,nz,.5,B.y,1.5)||side===-1){riding=false;scene.add(person);W.x=nx;W.z=nz;W.y=Math.max(groundAt(nx,nz),B.y);W.h=B.moveH;W.vy=0;helmet.visible=false;hair.visible=true;break;}}
  }
}
function nearestRoad(x,z){
  let best=null;const kx=Math.round(x/GRID),kz=Math.round(z/GRID);
  for(let k=kx-1;k<=kx+1;k++){const rx=roadX(k,z),d=Math.abs(rx-x);if(!best||d<best.d){const dd=dRoadX(k,z);best={d,x:rx,z,h:Math.atan2(dd,1)};}}
  for(let k=kz-1;k<=kz+1;k++){const rz=roadZ(k,x),d=Math.abs(rz-z);if(!best||d<best.d){const dd=dRoadZ(k,x);best={d,x,z:rz,h:Math.atan2(1,dd)};}}
  return best;
}
function respawn(){
  const P=playerPos(),r=nearestRoad(P.x,P.z);
  Object.assign(B,{x:r.x,z:r.z,h:r.h,moveH:r.h,v:0,vy:0,pitch:0,pitchV:0,flipAcc:0,spinAcc:0,airT:0,air:false});
  B.y=B.lastG=groundAt(B.x,B.z);
  if(!riding)mount();
}
// pointer: left = fire, right-drag = look
let drag=null;
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('pointerdown',e=>{initAudio();if(e.pointerType==='touch'){drag=e.clientX;return;}if(e.button===0)mouseFire=true;else drag=e.clientX;});
addEventListener('pointerup',()=>{drag=null;mouseFire=false;});
addEventListener('pointermove',e=>{if(drag!==null){camYaw-=(e.clientX-drag)*.008;drag=e.clientX;}});
addEventListener('wheel',e=>{zoom=clamp(zoom*(1+e.deltaY*.001),.5,2.5);},{passive:true});
if('ontouchstart' in window||navigator.maxTouchPoints>0){
  document.getElementById('touch').style.display='flex';
  document.querySelectorAll('#touch button').forEach(b=>{const k=b.dataset.k;
    b.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();initAudio();if(!keys.has(k))onPress(k);keys.add(k);});
    ['pointerup','pointerleave','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>keys.delete(k)));});
}
const fxCanvas=document.getElementById('fxCanvas'),fx2d=fxCanvas.getContext('2d');
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);
  fxCanvas.width=innerWidth;fxCanvas.height=innerHeight;const s=renderer.domElement.height*.87;glow.mat.uniforms.uScale.value=smoke.mat.uniforms.uScale.value=s;}
addEventListener('resize',resize);resize();

// =====================================================================
//  UI helpers: banner, floating text, flashes, level up
// =====================================================================
const bannerEl=document.getElementById('banner');
function banner(big,small='',color='#ffd23f'){bannerEl.innerHTML=`<span style="color:${color}">${big}</span>${small?`<small>${small}</small>`:''}`;
  bannerEl.classList.remove('show');void bannerEl.offsetWidth;bannerEl.classList.add('show');}
const floatersEl=document.getElementById('floaters'),floaters=[];
function floatText(txt,x,y,z,color='#fff',size=18){const d=document.createElement('div');d.textContent=txt;d.style.color=color;d.style.fontSize=size+'px';floatersEl.appendChild(d);floaters.push({d,p:new V3(x,y,z),t:0});}
const flashEl=document.getElementById('flash'),hurtEl=document.getElementById('hurt'),vigEl=document.getElementById('vignette');
let flashA=0,hurtA=0;
function flashScreen(color,a){flashEl.style.background=color;flashA=a;}
function addXP(n,pos){
  n=Math.round(n*ST.xpMul);S.xp+=n;S.score+=n;
  if(pos)floatText('+'+n,pos.x,pos.y,pos.z,'#ffd23f',16);
  while(S.xp>=xpNeed()){S.xp-=xpNeed();S.level++;S.pendingLevels++;}
  if(S.pendingLevels&&!S.paused)setTimeout(showLevelUp,350);
}
let cardChoices=[];
function showLevelUp(){
  if(S.paused||!S.pendingLevels)return;S.paused=true;SFX.level();
  const P=playerPos();burst(P.x,P.y+1.5,P.z,120,20,1.4,.7,.1,[0xffd23f,0xffffff,0xffa53f],8);
  cardChoices=[...UPGRADES].sort(()=>Math.random()-.5).slice(0,3);
  document.getElementById('cards').innerHTML=cardChoices.map((u,i)=>`<button class="card" data-i="${i}"><div class="t">${u.t}</div><div class="d">${u.d}</div><kbd>${i+1}</kbd></button>`).join('');
  document.querySelectorAll('.card').forEach(b=>b.onclick=()=>pickCard(+b.dataset.i));
  document.getElementById('levelup').style.display='flex';
}
function pickCard(i){const u=cardChoices[i];if(!u)return;u.f();S.pendingLevels--;S.paused=false;document.getElementById('levelup').style.display='none';
  banner(u.t.toUpperCase(),`Level ${S.level-S.pendingLevels}`,'#ffd23f');keys.clear();clock.getDelta();if(S.pendingLevels)setTimeout(showLevelUp,600);}

// =====================================================================
//  combat
// =====================================================================
const projs=[],orbs=[];
const boltGeo=new THREE.BoxGeometry(.14,.14,1.4),rocketGeo=new THREE.CylinderGeometry(.14,.18,.9,8).rotateX(PI/2),pelletGeo=new THREE.SphereGeometry(.13,6,5);
const reticle=document.getElementById('reticle');
let aimTarget=null;
function findTarget(P){
  let best=null,score=1e9;const fx=Math.sin(P.h),fz=Math.cos(P.h);
  for(const e of entities){if(!e.alive||e.type==='gem'||e.type==='cone')continue;
    const dx=e.x-P.x,dz=e.z-P.z,d=Math.hypot(dx,dz);if(d>(e.type==='drone'?95:55)||d<2)continue;
    const ang=Math.acos(clamp((dx*fx+dz*fz)/d,-1,1));if(ang>.32)continue;
    const s=ang*40+d*(e.type==='drone'?.5:1);if(s<score){score=s;best=e;}}
  return best;
}
function shoot(P){
  const w=WEAPONS[S.weapon];S.fireCd=1/(w.rate*ST.fire);
  const fx=Math.sin(P.h),fz=Math.cos(P.h);
  const o=new V3(P.x+fx*1.6,P.y+(riding?2.1:1.6),P.z+fz*1.6);
  let dir;
  if(aimTarget){dir=new V3(aimTarget.x,aimTarget.y+(aimTarget.type==='drone'?0:.8),aimTarget.z).sub(o).normalize();}
  else dir=new V3(fx,riding?-B.pitch*.5:0,fz).normalize();
  for(let i=0;i<w.pellets;i++){
    const d=dir.clone().add(new V3(rnd(w.spread),rnd(w.spread),rnd(w.spread))).normalize();
    const geo=w.name==='Rocket'?rocketGeo:w.pellets>1?pelletGeo:boltGeo;
    const m=new THREE.Mesh(geo,Basic(w.color,{transparent:true,blending:THREE.AdditiveBlending}));m.position.copy(o);m.lookAt(o.clone().add(d));scene.add(m);
    const vel=d.multiplyScalar(w.speed);if(riding){vel.x+=fx*B.v;vel.z+=fz*B.v;}
    projs.push({m,p:o.clone(),v:vel,life:w.life,dmg:w.dmg*ST.dmg,splash:w.splash||0,color:w.color,rocket:w.name==='Rocket'});
  }
  burst(o.x,o.y,o.z,8,8,.15,.6,.1,[w.color,0xffffff],0,4);
  SFX[w.sfx]();
  if(w.name==='Rocket')shake=Math.max(shake,.15);
}
function damageEntity(e,dmg,src){
  if(!e.alive||e.type==='gem')return;
  e.hp-=dmg;e.hitFlash=.12;
  if(e.hp<=0)destroyEntity(e,src);
}
function destroyEntity(e,src){
  if(!e.alive)return;e.alive=false;scene.remove(e.mesh);
  const {x,y,z}=e;
  if(e.type==='crate'){addDebris(x,y+.8,z,MAT.crate,7,.55,7);burst(x,y+.8,z,14,5,.9,1.2,2.5,[0xb9853f,0x8a6030],4,2,smoke,.7);addXP(15,{x,y:y+2,z});notify('crate');
    tone(140,.15,'square',.08,.5);if(Math.random()<.35)addEntity(e.ch,'gem',x,z);}
  else if(e.type==='barrel'){explode(x,y+.7,z,8,60,e);addXP(20,{x,y:y+2,z});notify('barrel');}
  else if(e.type==='cone'){addDebris(x,y+.4,z,MAT.cone,2,.35,6);}
  else if(e.type==='drone'){explode(x,y,z,5,20,e,.6);addDebris(x,y,z,MAT.droneBody,6,.45,9);addXP(60,{x,y:y+2,z});notify('drone');
    if(Math.random()<.6)addEntity(e.ch,'gem',x,z);}
}
function explode(x,y,z,r,dmg,src,scale=1){
  burst(x,y,z,Math.round(60*scale),16*scale,.7,2.2*scale,.2,[0xffd060,0xff8a2a,0xff5520,0xffffff],-2,2.2);
  burst(x,y,z,Math.round(30*scale),30*scale,.6,.35,.05,[0xffe08a,0xffffff],22,.8);
  burst(x,y,z,Math.round(28*scale),5*scale,2.2,2*scale,6*scale,[0x3a3a3a,0x555555,0x6a6a6a],-1.5,1.2,smoke,.7);
  shockRing(x,Math.max(y-.5,groundAt(x,z)+.2),z,r*1.6,0xffa040);
  boomLight.position.set(x,y+1,z);boomLight.intensity=8*scale;
  const P=playerPos(),pd=Math.hypot(P.x-x,P.y+1-y,P.z-z);
  shake=Math.max(shake,clamp(1.1-pd/50,0,1)*.9*scale);SFX.boom(clamp(1.2-pd/120,.2,1)*scale);
  for(const e of entities){if(!e.alive||e===src||e.type==='gem')continue;const d=Math.hypot(e.x-x,e.y-y,e.z-z);
    if(d<r){if(e.type==='barrel'){e.fuse=.12+Math.random()*.12;}else damageEntity(e,dmg*(1-d/r));}}
  if(pd<r&&src!=='player-rocket'||pd<r*.5){hurt(dmg*.45*(1-pd/r));if(riding){B.vy+=11*(1-pd/r);B.air=true;}else W.vy+=8;}
}
function hurt(n){
  if(S.dead||n<=0)return;S.hp-=n;S.lastHurt=clock.elapsedTime;hurtA=Math.min(.9,hurtA+.5);shake=Math.max(shake,.3);SFX.hurt();
  if(S.hp<=0)wreck();
}
function wreck(){S.dead=true;S.hp=0;banner('WRECKED','respawning…','#ff4d5e');SFX.crash();S.combo=0;
  const P=playerPos();explode(P.x,P.y+1,P.z,0,0,'none',.8);
  setTimeout(()=>{S.hp=ST.hpMax;S.dead=false;respawn();},1800);}

// =====================================================================
//  physics helpers
// =====================================================================
function blocked(nx,nz,r,y,maxStep){
  const g=groundAt(nx,nz);
  if(g<.2)return 'water';
  if(g-y>maxStep)return 'wall';
  for(const c of nearChunks(nx,nz))for(const o of c.obs){const dx=nx-o.x,dz=nz-o.z,rr=r+o.r;if(dx*dx+dz*dz<rr*rr&&y<o.top)return 'tree';}
  return false;
}
function entityHit(x,y,z,r){
  for(const e of entities){if(!e.alive||e.type==='gem'||e.type==='drone')continue;const dx=x-e.x,dz=z-e.z,rr=r+e.r;if(dx*dx+dz*dz<rr*rr&&y<e.y+1.8)return e;}
  return null;
}

// =====================================================================
//  bike & walker updates
// =====================================================================
function crash(reason){
  banner('CRASH!',reason,'#ff4d5e');SFX.crash();shake=.9;flashScreen('#ff3040',.25);
  B.v*=.15;B.pitch=0;B.pitchV=0;B.h=B.moveH;S.combo=0;hurt(15);
  burst(B.x,B.y+.5,B.z,30,6,1.4,1.5,4,[0x9a8a70,0x7a6a55],-1,1.5,smoke,.7);
}
function land(){
  const p=wrapPi(B.pitch),yawErr=wrapPi(B.h-B.moveH),air=B.airT;
  const impact=B.impact||0;
  if(air>.35&&(Math.abs(p)>.8||Math.abs(yawErr)>.8)){crash(Math.abs(p)>.8?'Land your flips straight!':'Land facing forward!');}
  else{
    const flips=Math.round(Math.abs(B.flipAcc)/TAU),spins=Math.round(Math.abs(B.spinAcc)/TAU);
    const tricks=[];let pts=0;
    if(flips>0){tricks.push((B.flipAcc<0?'BACKFLIP':'FRONTFLIP')+(flips>1?' x'+flips:''));pts+=250*flips;notify('flip',flips);}
    if(spins>0){tricks.push((spins*360)+' SPIN');pts+=180*spins;}
    if(air>.9){tricks.push('BIG AIR '+air.toFixed(1)+'s');pts+=Math.round(air*80);}
    notify('air',air);
    if(tricks.length){S.combo=S.comboT>0?S.combo+1:1;S.comboT=5;pts*=S.combo;SFX.trick();
      banner(tricks.join(' + '),`+${Math.round(pts*ST.xpMul)} XP${S.combo>1?` · COMBO x${S.combo}`:''}`,flips?'#ff7ad9':'#ffd23f');
      addXP(pts);S.nitro=Math.min(ST.nitroMax,S.nitro+20*tricks.length);
      burst(B.x,B.y+1,B.z,50,14,1,.6,.1,[0xffd23f,0xff7ad9,0xffffff],6);}
    B.moveH=B.h;
  }
  B.pitch=wrapPi(B.pitch);B.flipAcc=B.spinAcc=0;B.airT=0;
  if(impact>8){shake=Math.max(shake,clamp(impact*.025,0,.6));
    for(let i=0;i<24;i++){const a=i/24*TAU;smoke.spawn(B.x,B.y+.2,B.z,Math.cos(a)*7,1,Math.sin(a)*7,1,1,3.5,0xb8a98c,.6,0,2.5);}
    tone(90,.15,'square',.08,.6);}
}
function updateBike(dt,k){
  const g0=groundAt(B.x,B.z),onRoad=roadDist(B.x,B.z)<5.5;
  let boosting=false;
  if(riding&&!S.dead){
    const wantN=(k.shift||k.space)&&S.nitro>1;
    if(wantN){if(!B.wasN){SFX.nitro();shake=Math.max(shake,.25);fovKick=8;}S.nitro-=28*dt;boosting=true;}
    B.wasN=wantN;
    if(B.pad>0){boosting=true;}
    const top=ST.top*(boosting?1.6:1)*(onRoad?1:.8);
    if(!B.air){
      if(k.up)B.v+=(B.v<0?40:ST.accel*(boosting?1.9:1))*dt;
      else if(boosting)B.v+=ST.accel*1.2*dt;
      if(k.down)B.v-=(B.v>0?38:10)*dt;
      if(!k.up&&!k.down&&!boosting)B.v*=1-1.0*dt;
      if(!onRoad)B.v*=1-.25*dt;
      if(B.v>top)B.v-=Math.min(B.v-top,30*dt);
      B.v=Math.max(B.v,-8);
      const steer=(k.left?1:0)-(k.right?1:0);
      B.h+=steer*ST.grip*clamp(Math.abs(B.v)/6,0,1)*Math.sign(B.v)*dt*(1-clamp((Math.abs(B.v)-35)/60,0,.4));
      B.moveH=B.h;
      B.lean=lerp(B.lean,-steer*clamp(Math.abs(B.v)/22,0,1)*.55,1-Math.exp(-dt*6));
    }else{
      const pitchIn=(k.up?1:0)-(k.down?1:0),spinIn=(k.left?1:0)-(k.right?1:0);
      B.pitchV+=pitchIn*16*dt;B.pitchV*=1-1.8*dt;
      const dp=B.pitchV*dt;B.pitch+=dp;B.flipAcc+=dp;
      if(!pitchIn&&Math.abs(B.pitchV)<1.5){const lv=clamp(-B.vy*.025,-.45,.35),cur=wrapPi(B.pitch);B.pitch+=(lv-cur)*Math.min(1,dt*2.5);}
      const ds=spinIn*4.6*dt;B.h+=ds;B.spinAcc+=ds;
      B.lean=lerp(B.lean,0,1-Math.exp(-dt*3));
      if(boosting)B.v+=8*dt;
    }
  }else{B.v*=1-3*dt;B.lean=lerp(B.lean,.22,1-Math.exp(-dt*4));B.wasN=false;}
  S.nitro=clamp(S.nitro+ST.nitroRegen*dt,0,ST.nitroMax);
  if(Math.abs(B.v)<.03)B.v=0;
  B.pad=Math.max(0,B.pad-dt);
  boostAmt=lerp(boostAmt,boosting&&riding?1:0,1-Math.exp(-dt*6));

  // horizontal move + collisions
  const nx=B.x+Math.sin(B.moveH)*B.v*dt,nz=B.z+Math.cos(B.moveH)*B.v*dt;
  if(B.v!==0){
    const blk=blocked(nx,nz,1,B.y,B.air?99:1.3);
    if(blk){if(Math.abs(B.v)>14){shake=.5;SFX.crash();hurt(Math.abs(B.v)*.35);burst(nx,B.y+1,nz,20,6,.8,1,3,[0x9a8a70],-1,2,smoke,.6);}B.v*=-.25;}
    else{
      const e=entityHit(nx,B.y,nz,.9);
      if(e){
        if(e.type==='cone'){destroyEntity(e);B.v*=.97;tone(500,.06,'square',.05);}
        else if(e.type==='barrel'){destroyEntity(e);}
        else if(e.type==='crate'){if(Math.abs(B.v)>16){destroyEntity(e);B.v*=.8;shake=Math.max(shake,.2);}else{B.v*=-.3;tone(120,.1,'square',.06);}}
      }else{if(riding)S.dist+=Math.abs(B.v)*dt,notify('dist',Math.abs(B.v)*dt);B.x=nx;B.z=nz;}
    }
  }
  // vertical
  const g=groundAt(B.x,B.z);
  B.vy-=30*dt;B.y+=B.vy*dt;
  if(B.y<=g){const wasAir=B.air,impactVy=B.vy;B.y=g;B.vy=clamp((g-B.lastG)/dt,-40,22);B.air=false;if(wasAir){B.impact=-impactVy;land();}}
  else if(!B.air&&B.y-g>.3){B.air=true;B.airT=0;B.flipAcc=B.spinAcc=0;B.pitchV=0;}
  if(B.air)B.airT+=dt;
  B.lastG=g;
  // pitch on ground follows slope
  if(!B.air){const fx=Math.sin(B.moveH),fz=Math.cos(B.moveH);
    const tp=-Math.atan2(groundAt(B.x+fx*1.05,B.z+fz*1.05)-groundAt(B.x-fx*1.05,B.z-fz*1.05),2.1);
    B.pitch=lerp(wrapPi(B.pitch),tp,1-Math.exp(-dt*12));}
  B.wheel+=B.v*dt/.62;wheels.forEach(w=>w.rotation.x=B.wheel);
  bike.position.set(B.x,B.y,B.z);bike.rotation.set(B.pitch,B.h,B.lean);

  // pads
  for(const pd of activePads){pd.cd-=dt;if(pd.cd<=0&&Math.hypot(pd.x-B.x,pd.z-B.z)<3.4&&Math.abs(B.y-pd.y)<1.5){
    pd.cd=1.2;B.pad=1.6;B.v=Math.max(B.v,ST.top*1.55);SFX.pad();fovKick=12;shake=Math.max(shake,.3);banner('BOOST PAD!','','#3cc8ff');
    burst(pd.x,pd.y+.5,pd.z,40,10,.8,.7,.1,[0x3cc8ff,0xffffff],0,2);}}
  // effects: exhaust, dust
  const fx=Math.sin(B.h),fz=Math.cos(B.h);
  flame.scale.set(1,lerp(flame.scale.y,boostAmt>.1?1.4+Math.random()*1.2:.01,.5),1);
  flame.material.color.setHex(B.pad>0?0xff66ff:0x66ccff);
  if(boostAmt>.1){const ex=B.x-fx*1.7+Math.cos(B.h)*.33,ez=B.z-fz*1.7-Math.sin(B.h)*.33;
    for(let i=0;i<3;i++)glow.spawn(ex,B.y+.65,ez,-fx*10+rnd(2),rnd(1.5)+1,-fz*10+rnd(2),.35,.9,.1,[0x66ccff,0x8a7dff,0xffffff][i],1,0,2);}
  if(riding&&!B.air&&Math.abs(B.v)>8&&!onRoad&&Math.random()<.8){const c=biome(B.x,B.z)<.4?0xd9b47a:0x8a7a5a;
    smoke.spawn(B.x-fx*1.1+rnd(.3),B.y+.2,B.z-fz*1.1+rnd(.3),-fx*2+rnd(1),1.5,-fz*2+rnd(1),1.1,.8,2.6,c,.55,-.5,1.5);}
  if(riding&&!B.air&&Math.abs(B.lean)>.35&&Math.abs(B.v)>20&&onRoad)smoke.spawn(B.x-fx*1.1,B.y+.15,B.z-fz*1.1,rnd(1),1,rnd(1),.9,.6,2.2,0xdddddd,.35,-.4,1.5);
}
function riderPose(){legL.rotation.set(-1.35,0,.12);legR.rotation.set(-1.35,0,-.12);armL.rotation.set(-1.15,0,-.15);armR.rotation.set(-1.15,0,.15);torso.rotation.x=.25;}
function updateWalker(dt,k){
  torso.rotation.x=0;legL.rotation.z=legR.rotation.z=armL.rotation.z=armR.rotation.z=0;
  const turn=(k.left?1:0)-(k.right?1:0);W.h+=turn*2.7*dt;
  const f=(k.up?1:0)-(k.down?1:0),spd=S.dead?0:f*(k.shift?12:6.5)*(f<0?.55:1);
  const nx=W.x+Math.sin(W.h)*spd*dt,nz=W.z+Math.cos(W.h)*spd*dt;
  if(spd!==0&&!blocked(nx,nz,.45,W.y,.9)&&!entityHit(nx,W.y,nz,.4)&&!(Math.hypot(nx-B.x,nz-B.z)<1.3&&W.y<B.y+1.5)){W.x=nx;W.z=nz;}
  if(k.space&&W.ground){W.vy=9.5;W.ground=false;tone(300,.12,'triangle',.06,1.6);}
  const g=groundAt(W.x,W.z);W.vy-=26*dt;W.y+=W.vy*dt;
  if(W.y<=g||(W.ground&&W.y-g<.6&&W.vy<=0)){W.y=g;W.vy=0;W.ground=true;}else W.ground=false;
  W.amt=lerp(W.amt,spd!==0&&W.ground?1:0,1-Math.exp(-dt*10));W.phase+=dt*Math.abs(spd)*1.5;
  const s=Math.sin(W.phase)*.9*W.amt;
  legL.rotation.x=W.ground?s:-.5;legR.rotation.x=W.ground?-s:.3;
  armL.rotation.x=-s*.8;armR.rotation.x=(k.fire||aimTarget)?-1.45:s*.8;
  person.position.set(W.x,W.y+Math.abs(Math.cos(W.phase))*.08*W.amt,W.z);person.rotation.set(0,W.h,0);
}

// =====================================================================
//  entities / projectiles update
// =====================================================================
function updateEntities(dt,P){
  const T=clock.elapsedTime,diff=clamp(Math.hypot(P.x,P.z)/2500,0,1);
  for(let i=entities.length-1;i>=0;i--){
    const e=entities[i];if(!e.alive){entities.splice(i,1);continue;}
    e.t+=dt;
    if(e.fuse>0){e.fuse-=dt;if(e.fuse<=0){destroyEntity(e);continue;}}
    if(e.hitFlash>0){e.hitFlash-=dt;e.mesh.scale.setScalar(1+e.hitFlash*1.5);}else e.mesh.scale.setScalar(1);
    if(e.type==='gem'){
      e.mesh.rotation.y+=dt*2.5;e.mesh.children[0].position.y=Math.sin(e.t*2.5)*.3;
      const dx=P.x-e.x,dy=P.y+1.2-e.y,dz=P.z-e.z,d=Math.hypot(dx,dy,dz);
      if(d<ST.magnet*2.2&&d>.01){const s=Math.min(d,25*dt);e.x+=dx/d*s;e.y+=dy/d*s;e.z+=dz/d*s;e.mesh.position.set(e.x,e.y,e.z);}
      if(d<1.8){e.alive=false;scene.remove(e.mesh);S.gems++;S.nitro=Math.min(ST.nitroMax,S.nitro+12);SFX.gem();
        burst(e.x,e.y,e.z,28,9,.7,.55,.05,[0x46e3ff,0xffffff,0x8af0ff],2,2);shockRing(e.x,e.y,e.z,3,0x46e3ff);
        flashScreen('#46e3ff',.12);addXP(25,{x:e.x,y:e.y+1,z:e.z});notify('gem');}
    }else if(e.type==='drone'){
      const u=e.inner.userData;u.rotors.forEach((r,j)=>r.rotation.y+=dt*40*(j%2?1:-1));
      const dx=P.x-e.x,dz=P.z-e.z,d=Math.hypot(dx,dz);
      let tx=e.x,tz=e.z,ty=groundAt(e.x,e.z)+7+Math.sin(e.t*2)*.6;
      if(d<85&&!S.dead){e.ang+=dt*.5;tx=P.x+Math.sin(e.ang)*18;tz=P.z+Math.cos(e.ang)*18;ty=Math.max(groundAt(tx,tz),P.y)+6+Math.sin(e.t*2)*.6;
        e.cool-=dt;const charge=e.cool<.5;u.eye.scale.setScalar(charge?1.6+Math.sin(T*40)*.3:1);
        if(e.cool<=0&&d<65){e.cool=lerp(2.6,1.3,diff)+Math.random()*.6;
          const lead=d/34,vx=riding?Math.sin(B.moveH)*B.v:0,vz=riding?Math.cos(B.moveH)*B.v:0;
          const tgt=new V3(P.x+vx*lead*.7,P.y+1.2,P.z+vz*lead*.7),o=new V3(e.x,e.y,e.z),dir=tgt.sub(o).normalize().multiplyScalar(34);
          const m=new THREE.Mesh(pelletGeo,MAT.orb);m.scale.setScalar(2.6);m.position.copy(o);scene.add(m);orbs.push({m,p:o.clone(),v:dir,life:4});SFX.orb();}
        e.mesh.lookAt(P.x,e.y,P.z);}
      const sp=Math.min(1,dt*1.6);e.x+=(tx-e.x)*sp;e.z+=(tz-e.z)*sp;e.y+=(ty-e.y)*sp;e.mesh.position.set(e.x,e.y,e.z);
      e.mesh.rotation.z=Math.sin(e.t*3)*.1;
    }
  }
  // projectiles
  for(let i=projs.length-1;i>=0;i--){
    const p=projs[i];p.life-=dt;let hit=false,hitE=null;
    const steps=Math.max(1,Math.ceil(p.v.length()*dt/1.2)),sdt=dt/steps;
    for(let s=0;s<steps&&!hit;s++){
      p.p.addScaledVector(p.v,sdt);if(p.rocket)p.v.y-=2*sdt;
      for(const e of entities){if(!e.alive||e.type==='gem')continue;const cy=e.type==='drone'?e.y:e.y+.8;
        const dx=p.p.x-e.x,dy=p.p.y-cy,dz=p.p.z-e.z;if(dx*dx+dy*dy+dz*dz<(e.r+.35)**2){hit=true;hitE=e;break;}}
      if(!hit&&p.p.y<groundAt(p.p.x,p.p.z))hit=true;
      if(!hit){const c=chunkAt(p.p.x,p.p.z);if(c)for(const o of c.obs){const dx=p.p.x-o.x,dz=p.p.z-o.z;if(dx*dx+dz*dz<o.r*o.r+.3&&p.p.y<o.top){hit=true;break;}}}
    }
    p.m.position.copy(p.p);
    if(p.rocket){smoke.spawn(p.p.x,p.p.y,p.p.z,rnd(.5),rnd(.5)+.5,rnd(.5),.9,.4,1.6,0xbbbbbb,.5,-.5,1);glow.spawn(p.p.x,p.p.y,p.p.z,0,0,0,.12,.7,.2,0xff8a2a,1);}
    if(hit||p.life<=0){
      if(p.splash&&(hit||p.life<=0))explode(p.p.x,p.p.y,p.p.z,p.splash,p.dmg,'player-rocket',.8);
      else if(hit){burst(p.p.x,p.p.y,p.p.z,10,7,.3,.4,.05,[p.color,0xffffff],8,2);if(hitE)SFX.hit();}
      if(hitE&&!p.splash){damageEntity(hitE,p.dmg);if(hitE.alive)floatText(Math.round(p.dmg),hitE.x,hitE.y+2,hitE.z,'#fff',13);}
      scene.remove(p.m);p.m.material.dispose();projs.splice(i,1);
    }
  }
  // enemy orbs
  for(let i=orbs.length-1;i>=0;i--){
    const o=orbs[i];o.life-=dt;o.p.addScaledVector(o.v,dt);o.m.position.copy(o.p);
    glow.spawn(o.p.x,o.p.y,o.p.z,rnd(.5),rnd(.5),rnd(.5),.3,1,.1,0xff3355,.9);
    const hitP=Math.hypot(o.p.x-P.x,o.p.y-(P.y+1.2),o.p.z-P.z)<1.5;
    if(hitP||o.life<=0||o.p.y<groundAt(o.p.x,o.p.z)){
      if(hitP){hurt(9);burst(o.p.x,o.p.y,o.p.z,20,8,.4,.6,.05,[0xff3355,0xffffff],4,2);}
      scene.remove(o.m);orbs.splice(i,1);}
  }
  // debris
  for(let i=debris.length-1;i>=0;i--){const d=debris[i];d.life-=dt;d.vy-=22*dt;d.m.position.x+=d.vx*dt;d.m.position.y+=d.vy*dt;d.m.position.z+=d.vz*dt;
    d.m.rotation.x+=d.ax*dt;d.m.rotation.z+=d.az*dt;const g=groundAt(d.m.position.x,d.m.position.z);
    if(d.m.position.y<g+.1){d.m.position.y=g+.1;d.vy*=-.35;d.vx*=.6;d.vz*=.6;d.ax*=.5;d.az*=.5;}
    if(d.life<.4)d.m.scale.multiplyScalar(.9);
    if(d.life<=0){scene.remove(d.m);debris.splice(i,1);}}
  // rings
  for(let i=rings.length-1;i>=0;i--){const r=rings[i];r.userData.t+=dt*2.4;const t=r.userData.t;r.scale.setScalar(.2+t*r.userData.r);r.material.opacity=1-t;
    if(t>=1){scene.remove(r);r.material.dispose();rings.splice(i,1);}}
}

// =====================================================================
//  minimap & speed lines
// =====================================================================
const mm=document.getElementById('minimap').getContext('2d');
function drawMinimap(P){
  const W2=160,R=200,sc=W2/(2*R);mm.clearRect(0,0,W2,W2);
  mm.fillStyle='rgba(40,70,45,.9)';mm.fillRect(0,0,W2,W2);
  const toM=(x,z)=>[W2/2-(x-P.x)*sc,W2/2-(z-P.z)*sc];
  mm.strokeStyle='#d8d8d8';mm.lineWidth=2.5;
  const kx=Math.round(P.x/GRID),kz=Math.round(P.z/GRID);
  for(let k=kx-2;k<=kx+2;k++){mm.beginPath();for(let z=P.z-R;z<=P.z+R;z+=10){const[a,b]=toM(roadX(k,z),z);z===P.z-R?mm.moveTo(a,b):mm.lineTo(a,b);}mm.stroke();}
  for(let k=kz-2;k<=kz+2;k++){mm.beginPath();for(let x=P.x-R;x<=P.x+R;x+=10){const[a,b]=toM(x,roadZ(k,x));x===P.x-R?mm.moveTo(a,b):mm.lineTo(a,b);}mm.stroke();}
  for(const e of entities){if(!e.alive)continue;const[a,b]=toM(e.x,e.z);if(a<0||b<0||a>W2||b>W2)continue;
    if(e.type==='gem'){mm.fillStyle='#46e3ff';mm.fillRect(a-1.5,b-1.5,3,3);}
    else if(e.type==='drone'){mm.fillStyle='#ff3355';mm.beginPath();mm.arc(a,b,3.5,0,TAU);mm.fill();}}
  for(const r of activeRamps){const[a,b]=toM(r.x,r.z);mm.fillStyle='#f2a33a';mm.fillRect(a-2.5,b-2.5,5,5);}
  if(!riding){const[a,b]=toM(B.x,B.z);mm.fillStyle='#4d8dff';mm.beginPath();mm.arc(a,b,4,0,TAU);mm.fill();}
  mm.save();mm.translate(W2/2,W2/2);mm.rotate(-P.h);mm.fillStyle='#ffd23f';mm.beginPath();mm.moveTo(0,-7);mm.lineTo(5,6);mm.lineTo(-5,6);mm.closePath();mm.fill();mm.restore();
  mm.fillStyle='rgba(255,255,255,.7)';mm.font='bold 10px system-ui';mm.fillText('N',W2/2-3,11);
}
// note: minimap is drawn with +z pointing down, so flip the arrow math accordingly
function drawSpeedLines(intensity){
  fx2d.clearRect(0,0,fxCanvas.width,fxCanvas.height);if(intensity<.03)return;
  const cx=fxCanvas.width/2,cy=fxCanvas.height*.45,R=Math.hypot(cx,cy);
  fx2d.lineCap='round';
  for(let i=0;i<Math.round(70*intensity);i++){
    const a=Math.random()*TAU,r1=R*(.42+Math.random()*.35),r2=r1+R*(.08+Math.random()*.25)*intensity;
    fx2d.strokeStyle=`rgba(255,255,255,${(.12+Math.random()*.3)*intensity})`;fx2d.lineWidth=1+Math.random()*2.2;
    fx2d.beginPath();fx2d.moveTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1);fx2d.lineTo(cx+Math.cos(a)*r2,cy+Math.sin(a)*r2);fx2d.stroke();
  }
}

// =====================================================================
//  main loop
// =====================================================================
const $=id=>document.getElementById(id);
const hudEls={speed:$('speed'),mode:$('mode'),hpTxt:$('hpTxt'),hpBar:$('hpBar'),nTxt:$('nTxt'),nBar:$('nBar'),lvl:$('lvl'),xpTxt:$('xpTxt'),xpBar:$('xpBar'),score:$('score'),gems:$('gems'),dist:$('dist'),
  ch:$('challenge'),cTxt:$('cTxt'),cBar:$('cBar'),cTime:$('cTime'),prompt:$('prompt')};
const camPos=new V3(),look=new V3(),_v=new V3();
const clock=new THREE.Clock();
streamChunks(B.x,B.z,999);
B.y=B.lastG=groundAt(B.x,B.z);W.y=groundAt(W.x,W.z);
camera.position.set(B.x-Math.sin(B.h)*12,B.y+7,B.z-Math.cos(B.h)*12);look.set(B.x,B.y,B.z);
$('loading').remove();
setTimeout(()=>banner('MOTO INFINITE','Walk to the bike and press E','#ffd23f'),300);
let frame=0;
(function loop(){
  requestAnimationFrame(loop);
  const dt=clamp(clock.getDelta(),.001,.05),Tm=clock.elapsedTime,k=K();frame++;
  if(S.paused){renderer.render(scene,camera);return;}

  updateBike(dt,k);
  if(riding)riderPose();else updateWalker(dt,k);
  const P=playerPos();
  streamChunks(P.x,P.z,2);

  // shooting
  aimTarget=findTarget(P);
  S.fireCd-=dt;if(k.fire&&S.fireCd<=0&&!S.dead)shoot(P);
  if(aimTarget){_v.set(aimTarget.x,aimTarget.y+(aimTarget.type==='drone'?0:.8),aimTarget.z).project(camera);
    if(_v.z<1){reticle.style.display='block';reticle.style.left=(_v.x*.5+.5)*innerWidth+'px';reticle.style.top=(-_v.y*.5+.5)*innerHeight+'px';}else reticle.style.display='none';}
  else reticle.style.display='none';

  updateEntities(dt,P);
  glow.update(dt);smoke.update(dt);

  // health regen, combo
  if(Tm-S.lastHurt>4&&!S.dead)S.hp=Math.min(ST.hpMax,S.hp+8*dt);
  if(S.comboT>0){S.comboT-=dt;if(S.comboT<=0)S.combo=0;}

  // challenges
  if(CH_STATE&&!CH_STATE.done){CH_STATE.t-=dt;if(riding)notify('speed',Math.abs(B.v)*3.6);
    if(CH_STATE.t<=0){CH_STATE.done=true;SFX.fail();banner('CHALLENGE FAILED','','#ff4d5e');chCooldown=8;}}
  else{chCooldown-=dt;if(chCooldown<=0)newChallenge();}

  // camera
  const speedKmh=Math.abs(B.v)*3.6;
  if(k.up||k.down)camYaw*=Math.exp(-dt*2.5);
  const dist=(riding?9+Math.abs(B.v)*.06-boostAmt*1.2:7)*zoom,ht=(riding?3.8:3.2)*zoom,a=P.h+camYaw;
  camPos.set(P.x-Math.sin(a)*dist,P.y+ht,P.z-Math.cos(a)*dist);
  camPos.y=Math.max(camPos.y,groundAt(camPos.x,camPos.z)+1.2);
  camera.position.lerp(camPos,1-Math.exp(-dt*(riding?7:6)));
  look.lerp(_v.set(P.x,P.y+1.6,P.z),1-Math.exp(-dt*12));
  camera.lookAt(look);
  if(shake>0){camera.position.x+=rnd(shake);camera.position.y+=rnd(shake);camera.position.z+=rnd(shake);shake=Math.max(0,shake-dt*1.6);}
  fovKick=Math.max(0,fovKick-dt*12);
  const fovT=62+(riding?clamp(speedKmh-40,0,140)*.11:0)+boostAmt*10+fovKick;
  camera.fov=lerp(camera.fov,fovT,1-Math.exp(-dt*5));camera.updateProjectionMatrix();

  // world follow
  sun.position.set(P.x+50,P.y+90,P.z+30);sun.target.position.set(P.x,P.y,P.z);
  water.position.set(Math.round(P.x/10)*10,0,Math.round(P.z/10)*10);
  const wp=waterGeo.attributes.position;
  for(let i=0;i<wp.count;i++){const x=wBase[i*3]+water.position.x,z=wBase[i*3+2]+water.position.z;wp.array[i*3+1]=Math.sin(x*.08+Tm)*.22+Math.cos(z*.1+Tm*1.3)*.22;}
  wp.needsUpdate=true;
  clouds.forEach(c=>{c.position.x+=c.userData.v*dt;if(c.position.x-P.x>260)c.position.x-=520;if(c.position.x-P.x<-260)c.position.x+=520;
    if(c.position.z-P.z>260)c.position.z-=520;if(c.position.z-P.z<-260)c.position.z+=520;});
  boomLight.intensity=Math.max(0,boomLight.intensity-dt*25);

  // screen effects
  const lineI=riding?clamp((speedKmh-95)/90,0,1)*.7+boostAmt*.7:0;
  drawSpeedLines(Math.min(1,lineI));
  vigEl.style.opacity=(boostAmt*.85).toFixed(3);
  hurtA=Math.max(0,hurtA-dt*1.2);hurtEl.style.opacity=Math.max(hurtA,S.hp<30?.25+Math.sin(Tm*6)*.15:0).toFixed(3);
  flashA=Math.max(0,flashA-dt*2.5);flashEl.style.opacity=flashA.toFixed(3);
  for(let i=floaters.length-1;i>=0;i--){const f=floaters[i];f.t+=dt;_v.copy(f.p).add(new V3(0,f.t*2,0)).project(camera);
    if(f.t>1.1||_v.z>1){f.d.remove();floaters.splice(i,1);continue;}
    f.d.style.left=(_v.x*.5+.5)*innerWidth+'px';f.d.style.top=(-_v.y*.5+.5)*innerHeight+'px';f.d.style.opacity=1-Math.max(0,f.t-.6)*2;}

  // audio engine
  if(AC&&engGain){const target=riding&&!muted?.045+boostAmt*.03:0;engGain.gain.setTargetAtTime(target,AC.currentTime,.05);
    engOsc.frequency.setTargetAtTime(45+Math.abs(B.v)*3.2+boostAmt*40+(B.air?30:0),AC.currentTime,.05);engFilt.frequency.setTargetAtTime(400+Math.abs(B.v)*25,AC.currentTime,.05);}

  // HUD
  if(frame%3===0){
    hudEls.speed.textContent=Math.round(riding?speedKmh:(k.up||k.down?(k.shift?43:23):0));
    hudEls.mode.textContent=S.dead?'Wrecked':riding?(B.air?`Airborne ${B.airT.toFixed(1)}s`:boostAmt>.3?'NITRO!':'Riding'):'On foot';
    hudEls.hpTxt.textContent=Math.ceil(S.hp)+' / '+ST.hpMax;hudEls.hpBar.style.width=(S.hp/ST.hpMax*100)+'%';
    hudEls.nTxt.textContent=Math.floor(S.nitro);hudEls.nBar.style.width=(S.nitro/ST.nitroMax*100)+'%';
    hudEls.lvl.textContent=S.level;hudEls.xpTxt.textContent=S.xp+' / '+xpNeed();hudEls.xpBar.style.width=(S.xp/xpNeed()*100)+'%';
    hudEls.score.textContent=S.score+(S.combo>1?` (x${S.combo})`:'');hudEls.gems.textContent=S.gems;hudEls.dist.textContent=(S.dist/1000).toFixed(2)+' km';
    if(CH_STATE&&!CH_STATE.done){hudEls.ch.style.display='block';const d=CH_STATE.def;hudEls.cTxt.textContent=d.txt(CH_STATE.n);
      hudEls.cBar.style.width=Math.min(100,CH_STATE.prog/CH_STATE.n*100)+'%';
      hudEls.cTime.textContent=(d.fmt?d.fmt(CH_STATE.prog):Math.floor(CH_STATE.prog))+' · '+Math.ceil(CH_STATE.t)+'s left';}
    else hudEls.ch.style.display='none';
    hudEls.prompt.style.display=!riding&&Math.hypot(W.x-B.x,W.z-B.z)<3.5?'block':'none';
    if(frame%6===0)drawMinimap(P);
  }
  renderer.render(scene,camera);
})();
