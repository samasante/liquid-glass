/**
 * WebGL renderer for the liquid-glass lens over a `<video>` or `<canvas>`.
 *
 * Safari refuses to apply an SVG `filter: url()` to a live `<video>` (it
 * composites video on the GPU and never hands the frames to the filter
 * pipeline), so the DOM `<Glass>` path silently no-ops there. This renderer does
 * the same refraction on the GPU instead: it uploads each source frame as a
 * texture, samples the SAME displacement map our {@link createLensMapGenerator}
 * produces (R = X displacement, G = Y, B = specular), and runs a fragment shader
 * that mirrors the SVG filter chain — displacement, chromatic RGB-split, specular
 * lift — compositing the lens over the untouched source outside it.
 *
 * One renderer owns one WebGL2 context + one source texture + one output canvas,
 * and can draw MANY lenses from the one frame (each its own
 * {@link GlassLensDescriptor}). The displacement map is uploaded only when the
 * lens SHAPE changes; per-frame motion rides the uniforms.
 */

/** One lens to draw this frame, in normalized surface UV (origin top-left). */
export interface GlassLensDescriptor {
  /** Lens top-left as a 0..1 fraction of the surface. */
  originX: number;
  originY: number;
  /** Lens size as a 0..1 fraction of the surface. */
  sizeX: number;
  sizeY: number;
  /** Displacement scale in 0..1 UV units, per axis. */
  scaleX: number;
  scaleY: number;
  /** RGB-split strength — the `dispersion` lens param. */
  dispersion: number;
  /** Specular-highlight strength (our `specular`). */
  specular: number;
  /** Frost: gaussian blur of the refracted source inside the lens, in px (our
   *  `frost`). 0 = a clear lens; higher reads as frosted "liquid" glass. */
  blur: number;
  /** Corner radius as a 0..1 fraction of the SURFACE WIDTH. Drives the in-shader
   *  rounded-rect coverage that anti-aliases the lens silhouette. When omitted
   *  the lens is a sharp (AA'd) rectangle. */
  cornerRadius?: number;
  /** 0..1 fade for enter/exit animation (multiplies the lens coverage). The
   *  un-lensed source still shows underneath, so the lens dissolves cleanly into
   *  the backdrop. @default 1 */
  opacity?: number;
  /** White (>0) / black (<0) veil over the lens — the DOM path's `brightness`.
   *  @default 0 */
  brightness?: number;
  /** Per-lens displacement map. Lenses of different SHAPES (a round button vs a
   *  wide-thin scrub track) need their own map, or a non-square lens sampling the
   *  shared (square) map refracts as a stretched ellipse. Omit → the shared map
   *  set by {@link GlassWebGLRenderer.setDisplacementMap}. Cached by image identity. */
  dispMap?: TexImageSource;
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // a_pos is a -1..1 fullscreen quad; v_uv is bottom-left-origin 0..1, which
  // (with UNPACK_FLIP_Y on the textures) samples the source upright. The lens
  // descriptor is supplied in this same bottom-left space by the component.
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Pass 0: blit the raw source (top-left-origin sampling via 1 - y on upload-flip).
const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
void main() { o = texture(u_src, v_uv); }`;

// Separable Gaussian blur for the frosted-glass pass (σ≈2.2, 9 taps). Run once
// horizontally then once vertically into a ping-pong target; the lens samples the
// result as the frosted copy. `u_step` is one blur step along the pass axis.
const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_step;
void main() {
  vec4 c = texture(u_src, v_uv) * 0.1857;
  c += (texture(u_src, v_uv + u_step)       + texture(u_src, v_uv - u_step))       * 0.1671;
  c += (texture(u_src, v_uv + 2.0 * u_step) + texture(u_src, v_uv - 2.0 * u_step)) * 0.1227;
  c += (texture(u_src, v_uv + 3.0 * u_step) + texture(u_src, v_uv - 3.0 * u_step)) * 0.0768;
  c += (texture(u_src, v_uv + 4.0 * u_step) + texture(u_src, v_uv - 4.0 * u_step)) * 0.0414;
  o = c;
}`;

// Pass 1..N: one lens, composited OVER the blit by an anti-aliased rounded-rect
// coverage. The displacement map's alpha is always opaque (the shape is encoded
// as neutral grey outside the SDF), so clipping the silhouette in the SHADER is
// what gives a smooth lens edge — a hard `discard` (or MSAA on this fullscreen
// quad) cannot. The lens samples the SAME source it sits over, so mixing toward
// the backdrop by the coverage dissolves the edge cleanly with no seam.
const LENS_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_blur;
uniform sampler2D u_disp;
uniform vec2 u_origin;
uniform vec2 u_size;
uniform vec2 u_scale;
uniform vec2 u_lenspx;   // lens box size in device px (for an aspect-correct SDF)
uniform float u_radiuspx; // corner radius in device px
uniform float u_dispersion;
uniform float u_sheen;
uniform float u_frost;    // 0 = sharp; >0 = blend toward the pre-blurred copy
uniform float u_opacity;  // enter/exit fade (multiplies coverage)
uniform float u_brightness; // white(>0)/black(<0) veil over the lens
// Signed distance to a rounded rectangle (negative inside). Computed in pixel
// space so the corner radius stays circular on non-square lenses. NB: the half-
// extent arg must NOT be named \`half\` — that's a reserved word in GLSL ES and
// Safari's (stricter) WebGL2 compiler rejects it, throwing at renderer init.
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
// Source sample, blended toward the frosted (pre-blurred) copy by mixAmt. The
// frost is what makes the glass read as liquid rather than a clear lens.
vec3 frosted(vec2 p, float mixAmt) {
  vec3 raw = texture(u_src, p).rgb;
  return mixAmt > 0.0 ? mix(raw, texture(u_blur, p).rgb, mixAmt) : raw;
}
void main() {
  vec2 lensUV = (v_uv - u_origin) / u_size;
  // Rounded-rect coverage. The SDF is in device px and a true distance field
  // (gradient ~1), so a fixed ~1px feather anti-aliases the edge without fwidth
  // (derivatives are handled inconsistently across WebGL2 backends).
  vec2 p = (lensUV - 0.5) * u_lenspx;
  float sdf = sdRoundRect(p, u_lenspx * 0.5, min(u_radiuspx, min(u_lenspx.x, u_lenspx.y) * 0.5));
  float coverage = (1.0 - smoothstep(-1.0, 1.0, sdf)) * u_opacity;
  if (coverage <= 0.0) discard;
  vec4 d = texture(u_disp, clamp(lensUV, 0.0, 1.0));
  vec2 disp = (d.rg - 0.5) * u_scale;            // feDisplacementMap equivalent
  // RGB split — red bent DISPERSION_SPREAD more than blue, green half that (keep
  // in sync with DISPERSION_SPREAD in displacement.ts so DOM + WebGL match).
  vec2 uvR = v_uv + disp * (1.0 + u_dispersion * 0.22);
  vec2 uvG = v_uv + disp * (1.0 + u_dispersion * 0.11);
  vec2 uvB = v_uv + disp;
  vec3 lensCol = vec3(frosted(uvR, u_frost).r, frosted(uvG, u_frost).g, frosted(uvB, u_frost).b);
  // Specular lift from B. The map encodes spec as B = 127·s + 128, so (B/255 − 0.5)
  // = 0.498·s; this matches the DOM path's gain exactly (feColorMatrix 1× alpha
  // then feComposite k2=specular → 0.498·specular·s). (NOT ×2 — that double-lifted it.)
  lensCol += u_sheen * max(0.0, d.b - 0.5);
  // Brightness veil (alpha-blend toward white/black, like the DOM path).
  if (u_brightness > 0.0) lensCol = mix(lensCol, vec3(1.0), clamp(u_brightness, 0.0, 1.0));
  else if (u_brightness < 0.0) lensCol = mix(lensCol, vec3(0.0), clamp(-u_brightness, 0.0, 1.0));
  // Mix over the untouched backdrop by the coverage → an AA'd, frosted-clipping
  // silhouette. Canvas stays fully opaque, so straight/premultiplied alpha is moot.
  vec3 backdrop = texture(u_src, v_uv).rgb;
  o = vec4(mix(backdrop, lensCol, coverage), 1.0);
}`;

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`glass-webgl shader: ${log}`);
  }
  return sh;
};

const link = (gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) => {
  const p = gl.createProgram()!;
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, "a_pos");
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`glass-webgl link: ${log}`);
  }
  return p;
};

export class GlassWebGLRenderer {
  private gl: WebGL2RenderingContext;
  private blit: WebGLProgram;
  private lens: WebGLProgram;
  private blur: WebGLProgram;
  private srcTex: WebGLTexture;
  private dispTex: WebGLTexture;
  // Per-lens displacement maps (different lens SHAPES need their own), keyed by
  // the image identity so each is uploaded to its own texture exactly once.
  private dispCache = new Map<TexImageSource, WebGLTexture>();
  private blurTex: [WebGLTexture, WebGLTexture]; // ping-pong frost targets
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  private blurW = 0;
  private blurH = 0;
  private quad: WebGLBuffer;
  private uLens: Record<string, WebGLUniformLocation | null>;
  private uBlur: Record<string, WebGLUniformLocation | null>;
  private uBlitSrc: WebGLUniformLocation | null;
  private srcW = 0;
  private srcH = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    this.blit = link(gl, VERT, BLIT_FRAG);
    this.lens = link(gl, VERT, LENS_FRAG);
    this.blur = link(gl, VERT, BLUR_FRAG);

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const makeTex = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    this.srcTex = makeTex();
    this.dispTex = makeTex();
    this.blurTex = [makeTex(), makeTex()];
    this.fbo = [gl.createFramebuffer()!, gl.createFramebuffer()!];

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // sources are top-down

    this.uBlitSrc = gl.getUniformLocation(this.blit, "u_src");
    this.uBlur = {
      src: gl.getUniformLocation(this.blur, "u_src"),
      step: gl.getUniformLocation(this.blur, "u_step"),
    };
    this.uLens = {
      src: gl.getUniformLocation(this.lens, "u_src"),
      blur: gl.getUniformLocation(this.lens, "u_blur"),
      disp: gl.getUniformLocation(this.lens, "u_disp"),
      origin: gl.getUniformLocation(this.lens, "u_origin"),
      size: gl.getUniformLocation(this.lens, "u_size"),
      scale: gl.getUniformLocation(this.lens, "u_scale"),
      lenspx: gl.getUniformLocation(this.lens, "u_lenspx"),
      radiuspx: gl.getUniformLocation(this.lens, "u_radiuspx"),
      dispersion: gl.getUniformLocation(this.lens, "u_dispersion"),
      specular: gl.getUniformLocation(this.lens, "u_sheen"),
      frost: gl.getUniformLocation(this.lens, "u_frost"),
      opacity: gl.getUniformLocation(this.lens, "u_opacity"),
      brightness: gl.getUniformLocation(this.lens, "u_brightness"),
    };
  }

  /** (Re)allocate the ping-pong frost targets to the source size. */
  private ensureBlurTargets(w: number, h: number) {
    if (w === this.blurW && h === this.blurH) return;
    const gl = this.gl;
    for (let i = 0; i < 2; i += 1) {
      gl.bindTexture(gl.TEXTURE_2D, this.blurTex[i]);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[i]);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.blurTex[i],
        0,
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.blurW = w;
    this.blurH = h;
  }

  /** Two-pass separable blur of the current source texture into blurTex[1]. */
  private renderFrost(blurPx: number) {
    const gl = this.gl;
    this.ensureBlurTargets(this.srcW, this.srcH);
    gl.useProgram(this.blur);
    gl.viewport(0, 0, this.srcW, this.srcH);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uBlur.src, 0);
    // Horizontal: src -> blurTex[0].
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[0]);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform2f(this.uBlur.step, blurPx / this.srcW, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Vertical: blurTex[0] -> blurTex[1].
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1]);
    gl.bindTexture(gl.TEXTURE_2D, this.blurTex[0]);
    gl.uniform2f(this.uBlur.step, 0, blurPx / this.srcH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Upload the displacement-map image (call only when the lens SHAPE changes). */
  setDisplacementMap(img: TexImageSource): void {
    if (this.disposed) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.dispTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }

  /** Texture for a per-lens displacement map, uploaded once and cached by the
   *  image identity (a lens of a different shape supplies its own map). */
  private dispTexFor(img: TexImageSource): WebGLTexture {
    const gl = this.gl;
    let tex = this.dispCache.get(img);
    if (!tex) {
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.dispCache.set(img, tex);
    }
    return tex;
  }

  /** Free a per-lens map texture (its shape is no longer used) so the cache
   *  can't grow unbounded as a responsive lens re-keys. */
  releaseDispMap(img: TexImageSource): void {
    const tex = this.dispCache.get(img);
    if (tex) {
      this.gl.deleteTexture(tex);
      this.dispCache.delete(img);
    }
  }

  /** Size the drawing buffer (CSS px × dpr). */
  resize(w: number, h: number): void {
    const c = this.gl.canvas as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  private uploadSource(src: TexImageSource, w: number, h: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    if (w !== this.srcW || h !== this.srcH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      this.srcW = w;
      this.srcH = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
  }

  /** Upload `source` once and draw every lens over it. */
  render(
    source: TexImageSource,
    srcW: number,
    srcH: number,
    lenses: GlassLensDescriptor[],
  ): void {
    if (this.disposed || srcW === 0 || srcH === 0) return;
    const gl = this.gl;
    this.uploadSource(source, srcW, srcH);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);

    // Frost pre-pass: blur the source once (at the strongest lens's blur) into the
    // ping-pong target; the lens shader mixes it in for the frosted look.
    const maxBlur = lenses.reduce((mx, d) => Math.max(mx, d.blur), 0);
    if (maxBlur > 0) this.renderFrost(maxBlur);

    const cw = (gl.canvas as HTMLCanvasElement).width;
    const ch = (gl.canvas as HTMLCanvasElement).height;
    gl.viewport(0, 0, cw, ch);

    // Pass 0 — raw source.
    gl.useProgram(this.blit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(this.uBlitSrc, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Pass 1..N — one lens each, refracting the source (discard outside).
    gl.useProgram(this.lens);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(this.uLens.src, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.dispTex);
    gl.uniform1i(this.uLens.disp, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.blurTex[1]);
    gl.uniform1i(this.uLens.blur, 2);
    for (const d of lenses) {
      const opacity = d.opacity ?? 1;
      if (opacity <= 0) continue; // fully faded out → nothing to draw
      // Per-lens displacement map (a differently-shaped lens needs its own, or it
      // refracts as a stretched ellipse); falls back to the shared dispTex.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(
        gl.TEXTURE_2D,
        d.dispMap ? this.dispTexFor(d.dispMap) : this.dispTex,
      );
      gl.uniform2f(this.uLens.origin, d.originX, d.originY);
      gl.uniform2f(this.uLens.size, d.sizeX, d.sizeY);
      gl.uniform2f(this.uLens.scale, d.scaleX, d.scaleY);
      // Lens box + corner radius in device px for the aspect-correct SDF.
      gl.uniform2f(this.uLens.lenspx, d.sizeX * cw, d.sizeY * ch);
      gl.uniform1f(this.uLens.radiuspx, (d.cornerRadius ?? 0) * cw);
      gl.uniform1f(this.uLens.dispersion, d.dispersion);
      gl.uniform1f(this.uLens.specular, d.specular);
      // Frost mix ramps to full like the DOM feGaussianBlur (the blur radius
      // already scales with d.blur via renderFrost's step), so a given Frost
      // value reads the same on both paths.
      gl.uniform1f(this.uLens.frost, d.blur > 0 ? Math.min(1, d.blur / 8) : 0);
      gl.uniform1f(this.uLens.opacity, opacity);
      gl.uniform1f(this.uLens.brightness, d.brightness ?? 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteProgram(this.blit);
    gl.deleteProgram(this.lens);
    gl.deleteProgram(this.blur);
    gl.deleteTexture(this.srcTex);
    gl.deleteTexture(this.dispTex);
    this.dispCache.forEach((t) => gl.deleteTexture(t));
    this.dispCache.clear();
    gl.deleteTexture(this.blurTex[0]);
    gl.deleteTexture(this.blurTex[1]);
    gl.deleteFramebuffer(this.fbo[0]);
    gl.deleteFramebuffer(this.fbo[1]);
    gl.deleteBuffer(this.quad);
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  }
}
