// One GPU pass, capped pixel density; the 2D solids keep their existing canvas.
window.Mode3Background = {
  canvas: null, gl: null, failed: false, center: [0.5,0.5], target: [0.5,0.5], pointers: [[.5,.5],[.5,.5]], weights: [0,0], held: [false,false], blur: 0, hue: 0,
  init() {
    if(this.canvas)return;
    this.canvas=document.createElement("canvas");
    const gl=this.canvas.getContext("webgl",{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
    if(!gl){this.failed=true;return;}
    this.gl=gl;
    this.canvas.addEventListener("webglcontextlost",e=>{e.preventDefault();this.failed=true;});
    this.canvas.addEventListener("webglcontextrestored",()=>{this.canvas=null;this.failed=false;this.init();});
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
    try {
      const vertex=compile(gl.VERTEX_SHADER,"attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}");
      const fragment=compile(gl.FRAGMENT_SHADER,`
        precision highp float;
        varying vec2 uv;
        uniform vec2 resolution,center,pointer0,pointer1;
        uniform vec2 active;
        uniform float time,radius,palette,hue;
        vec2 warp(vec2 p,vec2 finger,float on){
          vec2 d=p-finger;float r=length(d);float w=exp(-r*r/(radius*radius));
          return p+on*w*(d*.8+vec2(-d.y,d.x)*.7);
        }
        vec3 ink(float v){
          vec3 purple=vec3(.70,.04,.97),lavender=vec3(.64,.40,.72),yellow=vec3(1.,.98,.0);
          vec3 c=mix(lavender,purple,smoothstep(-.6,-.2,v));
          c=mix(c,yellow,smoothstep(.10,.15,v));
          c=mix(c,vec3(1.,.35,.01),smoothstep(.55,.61,v));
          c=mix(c,vec3(.08,.30,.08),smoothstep(.76,.80,v));
          c=mix(c,vec3(1.,.88,.0),smoothstep(.85,.90,v));
          float rim=exp(-pow((v-.12)*55.,2.))+exp(-pow((v+.2)*45.,2.));
          return mix(c,vec3(1.),clamp(rim*.9,0.,1.));
        }
        void main(){
          vec2 aspect=vec2(resolution.x/resolution.y,1.);
          vec2 p=uv*aspect;
          p=warp(p,pointer0*aspect,active.x);p=warp(p,pointer1*aspect,active.y);
          vec2 d=p-center*aspect;float r=max(length(d),.012);float a=atan(d.y,d.x);
          // Angular bands converge into a pulled focal point, like the reference.
          float angle=a+.08*sin(log(r)*3.+time*.17);
          float rays=sin(angle*15.+sin(angle*7.+time*.12)*3.+log(r)*1.1);
          float pools=sin(p.x*12.+sin(p.y*9.+time*.13)*2.)*sin(p.y*10.-p.x*3.);
          float v=sin(rays*2.7+pools*2.2+log(r)*.65-time*.12);
          vec3 c=ink(v);
          c=mix(c,c.brg,palette*.12);
          vec3 axis=normalize(vec3(1.));
          c=c*cos(hue)+cross(axis,c)*sin(hue)+axis*dot(axis,c)*(1.-cos(hue));
          gl_FragColor=vec4(clamp(c,0.,1.),1.);
        }
      `);
      const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      gl.deleteShader(vertex);gl.deleteShader(fragment);gl.useProgram(program);
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const at=gl.getAttribLocation(program,"p");gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
      this.program=program; this.position=at; this.buffer=buffer;
      this.uniforms={};for(const name of ["resolution","center","pointer0","pointer1","active","time","radius","palette","hue"])this.uniforms[name]=gl.getUniformLocation(program,name);
      const pv=compile(gl.VERTEX_SHADER,"attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}");
      const pf=compile(gl.FRAGMENT_SHADER,`
        precision mediump float;varying vec2 uv;uniform sampler2D source;uniform vec2 stepSize;
        void main(){
          // Normalized Gaussian, sampled densely to avoid separated ghost bands.
          vec3 c=vec3(0.);float total=0.;
          for(int i=-6;i<=6;i++){
            float offset=float(i);float weight=exp(-offset*offset/18.);
            c+=texture2D(source,uv+stepSize*offset/3.).rgb*weight;total+=weight;
          }
          c/=total;
          gl_FragColor=vec4(c,1.);
        }
      `);
      this.blurProgram=gl.createProgram();gl.attachShader(this.blurProgram,pv);gl.attachShader(this.blurProgram,pf);gl.linkProgram(this.blurProgram);
      if(!gl.getProgramParameter(this.blurProgram,gl.LINK_STATUS))throw Error("Blur shader failed");
      gl.deleteShader(pv);gl.deleteShader(pf);
      this.blurPosition=gl.getAttribLocation(this.blurProgram,"p");
      this.blurStep=gl.getUniformLocation(this.blurProgram,"stepSize");
      this.blurSource=gl.getUniformLocation(this.blurProgram,"source");
      this.targets=[0,1].map(()=>({texture:gl.createTexture(),frame:gl.createFramebuffer()}));
    }catch(error){this.failed=true;console.warn("Background GPU unavailable",error);}
  },
  draw(ctx) {
    this.trackInput();
    this.init();
    if(this.failed){this.fallback(ctx);return;}
    const gl=this.gl,u=this.uniforms,scale=Math.min(1.25,1440/width,1100/height);
    const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
    if(this.canvas.width!==w||this.canvas.height!==h){
      this.canvas.width=w;this.canvas.height=h;gl.viewport(0,0,w,h);
      for(const t of this.targets){
        gl.bindTexture(gl.TEXTURE_2D,t.texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.bindFramebuffer(gl.FRAMEBUFFER,t.frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.texture,0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){this.failed=true;this.fallback(ctx);return;}
      }
    }
    const blurred=this.blur>0.1;
    gl.bindFramebuffer(gl.FRAMEBUFFER,blurred?this.targets[0].frame:null);
    gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
    gl.uniform2f(u.resolution,w,h);gl.uniform2f(u.center,...this.center);
    for(let i=0;i<2;i++)gl.uniform2f(u["pointer"+i],...this.pointers[i]);
    gl.uniform2f(u.active,...this.weights);gl.uniform1f(u.hue,this.hue);
    gl.uniform1f(u.time,millis()/1000);gl.uniform1f(u.radius,Math.max(.08,APP.params.influenceRadius/height));gl.uniform1f(u.palette,APP.paletteMix);
    gl.drawArrays(gl.TRIANGLES,0,6);
    if(blurred){
      gl.useProgram(this.blurProgram);gl.enableVertexAttribArray(this.blurPosition);gl.vertexAttribPointer(this.blurPosition,2,gl.FLOAT,false,0,0);
      gl.activeTexture(gl.TEXTURE0);gl.uniform1i(this.blurSource,0);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[1].frame);gl.bindTexture(gl.TEXTURE_2D,this.targets[0].texture);
      gl.uniform2f(this.blurStep,this.blur/width,0);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,this.targets[1].texture);
      gl.uniform2f(this.blurStep,0,this.blur/height);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    ctx.drawImage(this.canvas,0,0,width,height);
  },
  trackInput() {
    const inputs=APP.touchInputUsed?APP.touchVoices:[APP];
    const current=inputs.map(v=>!!v.inputActive);
    let moved=false;
    if(!this.held.some(Boolean)&&current.some(Boolean))this.weights=[0,0];
    for(let i=0;i<2;i++){
      if(!current[i])continue;
      const p=inputs[i].interaction,x=p.x/width,y=1-p.y/height;
      if(!this.held[i]||Math.hypot(x-this.pointers[i][0],y-this.pointers[i][1])>.0001)moved=true;
      this.pointers[i]=[x,y];this.weights[i]=1;
    }
    if(moved){
      const active=this.pointers.filter((_,i)=>current[i]);
      this.target=[active.reduce((s,p)=>s+p[0],0)/active.length,active.reduce((s,p)=>s+p[1],0)/active.length];
    }
    this.held=[!!current[0],!!current[1]];
    const dt=Math.min(deltaTime,50)/1000,follow=1-Math.exp(-dt/.09);
    // Keep the last target and warp positions after release; never recenter automatically.
    for(let i=0;i<2;i++)this.center[i]+=(this.target[i]-this.center[i])*follow;
    const audible=AudioEngine.enabled&&AudioEngine.context?.state==="running";
    const collision=audible?Math.max(0,...inputs.map(v=>v.fmCollision||0)):0;
    const targetBlur=Math.max(0,(collision-.1)/.9)*13;
    this.blur+=(targetBlur-this.blur)*(1-Math.exp(-dt/(targetBlur > this.blur ? .07 : .4)));
    this.hue+=(APP.params.pitch/12*Math.PI-this.hue)*follow;
  },
  fallback(ctx) {
    // Bounded Canvas fallback for devices where WebGL is unavailable.
    const focus={x:this.center[0]*width,y:(1-this.center[1])*height};
    const reach=Math.hypot(width,height)*2,colors=["#ae18f4","#ad72b8","#ffff00","#ff6800","#fffdf0"];
    ctx.save();ctx.filter=`hue-rotate(${this.hue}rad) blur(${this.blur}px)`;ctx.translate(focus.x,focus.y);
    for(let i=0;i<100;i++){
      const a=i*Math.PI*2/100,warp=Math.sin(i*.7+millis()*.0002)*.018;
      ctx.fillStyle=colors[i%colors.length];ctx.beginPath();ctx.moveTo(0,0);
      ctx.lineTo(Math.cos(a+warp)*reach,Math.sin(a+warp)*reach);
      ctx.lineTo(Math.cos(a+Math.PI*.021+warp)*reach,Math.sin(a+Math.PI*.021+warp)*reach);ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }
};
