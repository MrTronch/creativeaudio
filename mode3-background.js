// Explicit 3D ring geometry: camera Z advances; sections pass near the camera
// and new world-space sections enter at the far end. No animated texture UVs.
const MODE3_TUNNEL = Object.freeze({ rings: 40, sides: 16, spacing: 1.35,
  speed: 2.1, radius: 2.5, maxWidth: 1100, maxHeight: 820,
  feedbackResolution: 640, feedbackMax: 0.20, response: 0.18, returnTime: 1.5 });
window.Mode3Background = {
  canvas: null, history: null, cameraZ: 0, steerX: 0, steerY: 0,
  feedback: 0, tint: 0, secondTint: 0, historyReady: false, primaryId: null,
  enter() { this.feedback=0;this.historyReady=false; },
  init() {
    if(this.canvas)return;
    this.canvas=document.createElement("canvas");this.ctx=this.canvas.getContext("2d",{alpha:false});
    this.history=document.createElement("canvas");this.historyCtx=this.history.getContext("2d",{alpha:false});
    const n=MODE3_TUNNEL.sides;
    this.crossX=new Float32Array(n+1);this.crossY=new Float32Array(n+1);
    this.projected=new Float32Array((MODE3_TUNNEL.rings+1)*(n+1)*2);
    this.ringDepth=new Float32Array(MODE3_TUNNEL.rings+1);
    for(let i=0;i<=n;i++){
      const angle=i/n*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
      this.crossX[i]=Math.sign(c)*Math.pow(Math.abs(c),0.82);
      this.crossY[i]=Math.sign(s)*Math.pow(Math.abs(s),0.82);
    }
  },
  trackInput(dt) {
    let first=null,second=null;
    if(APP.touchInputUsed){
      // Map insertion order is gesture order, independent of reused voice slots.
      for(const voice of APP.touchAssignments.values()){
        if(!voice.active)continue;
        if(!first)first=voice;else {second=voice;break;}
      }
    }else if(APP.inputActive)first=APP;
    this.primaryId=first ? (first.identifier??"mouse") : null;
    const x=first?constrain(first.interaction.x/width*2-1,-1,1):0;
    const y=first?constrain(first.interaction.y/height*2-1,-1,1):0;
    const follow=1-Math.exp(-dt/(first?MODE3_TUNNEL.response:MODE3_TUNNEL.returnTime));
    this.steerX+=(x-this.steerX)*follow;this.steerY+=(y-this.steerY)*follow;
    const trail=(APP.params.trailPersistence-1)/9;
    const target=second?MODE3_TUNNEL.feedbackMax*(0.45+trail*0.55):0;
    this.feedback+=(target-this.feedback)*(1-Math.exp(-dt/(second?.16:.5)));
    this.secondTint+=((second?(second.interaction.y/height-.5)*.10:0)-this.secondTint)*(1-Math.exp(-dt/.3));
    // Limited color variation follows the actual note and Pitch transposition.
    const midi=AudioEngine.currentMidi||MODE3_AUDIO.root;
    const pitch=constrain((midi-APP.params.pitch-(MODE3_AUDIO.root+18))/36,-1,1)*.08+APP.params.pitch/12*.65;
    this.tint+=(pitch-this.tint)*(1-Math.exp(-dt/.22));
  },
  draw(output) {
    this.init();
    const dt=Math.min(deltaTime/1000,.05);
    this.trackInput(dt);this.cameraZ+=MODE3_TUNNEL.speed*dt;
    const scale=Math.min(1.25,MODE3_TUNNEL.maxWidth/width,MODE3_TUNNEL.maxHeight/height);
    const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
    if(this.canvas.width!==w||this.canvas.height!==h){
      this.canvas.width=w;this.canvas.height=h;
      const hs=Math.min(1,MODE3_TUNNEL.feedbackResolution/Math.max(w,h));
      this.history.width=Math.max(1,Math.round(w*hs));this.history.height=Math.max(1,Math.round(h*hs));this.historyReady=false;
    }
    const ctx=this.ctx,cfg=MODE3_TUNNEL,n=cfg.sides,rows=cfg.rings;
    const camera=this.cameraZ,base=Math.floor(camera/cfg.spacing),focal=Math.max(w,h)*.72;
    const cameraX=Math.sin(camera*.14)*.75,cameraY=Math.sin(camera*.11+.9)*.55;
    const radius=cfg.radius,far=rows*cfg.spacing,points=this.projected,stride=(n+1)*2;
    for(let ring=0;ring<=rows;ring++){
      const worldZ=(base+ring)*cfg.spacing;
      // Clip the entering near ring to the near plane, instead of popping a panel.
      const z=Math.max(.22,worldZ-camera);this.ringDepth[ring]=z;
      const worldX=Math.sin(worldZ*.14)*.75-cameraX;
      const worldY=Math.sin(worldZ*.11+.9)*.55-cameraY;
      const bend=(z/far)*(z/far);
      const centerX=worldX+this.steerX*(z*.16+bend*3.8)+Math.sin(z/far*Math.PI)*1.2;
      const centerY=worldY+this.steerY*(z*.14+bend*3.0)+Math.sin(z/far*Math.PI*.8)*3.0;
      const twist=Math.sin(worldZ*.08)*.13+this.steerX*bend*.12;
      const c=Math.cos(twist),s=Math.sin(twist),perspective=focal/z;
      for(let side=0;side<=n;side++){
        const x=this.crossX[side]*radius,y=this.crossY[side]*radius;
        const index=ring*stride+side*2;
        points[index]=w/2+(centerX+x*c-y*s)*perspective;
        points[index+1]=h/2+(centerY+x*s+y*c)*perspective;
      }
    }
    ctx.fillStyle="#182322";ctx.fillRect(0,0,w,h);
    const hueShift=(this.tint+this.secondTint)*35;
    // Painter's algorithm: opaque far panels first, near panels last.
    for(let ring=rows-1;ring>=0;ring--){
      const depth=(this.ringDepth[ring]+this.ringDepth[ring+1])*.5;
      const light=0.76+0.24*Math.exp(-depth*.025);
      const greenHue=124+hueShift,magentaHue=301+hueShift;
      const mix=APP.paletteMix;
      const green=`hsl(${greenHue+(magentaHue-greenHue)*mix},${72+this.tint*7}%,${46*light}%)`;
      const magenta=`hsl(${magentaHue+(greenHue-magentaHue)*mix},${79+this.tint*7}%,${51*light}%)`;
      const front=ring*stride,back=(ring+1)*stride;
      if(this.ringDepth[ring]===this.ringDepth[ring+1])continue;
      // Two fills per ring, rather than a separate rasterization per checker cell.
      for(let parity=0;parity<2;parity++){
        ctx.fillStyle=((base+ring+parity)&1)?green:magenta;ctx.beginPath();
        for(let side=parity;side<n;side+=2){
          const a=front+side*2,b=back+side*2;
          ctx.moveTo(points[a],points[a+1]);ctx.lineTo(points[a+2],points[a+3]);
          ctx.lineTo(points[b+2],points[b+3]);ctx.lineTo(points[b],points[b+1]);ctx.closePath();
        }
        ctx.fill();
      }
    }
    // Bounded convex blend: no additive accumulation or full-resolution history.
    if(this.historyReady&&this.feedback>.002){
      const stretch=1.006;ctx.save();ctx.globalAlpha=this.feedback;
      ctx.drawImage(this.history,-w*(stretch-1)/2,-h*(stretch-1)/2,w*stretch,h*stretch);ctx.restore();
    }
    if(this.feedback>.002){
      this.historyCtx.drawImage(this.canvas,0,0,this.history.width,this.history.height);this.historyReady=true;
    }else this.historyReady=false;
    output.drawImage(this.canvas,0,0,width,height);
  }
};
