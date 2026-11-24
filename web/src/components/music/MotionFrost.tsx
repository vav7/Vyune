import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { useTier } from '@/lib/perf';

type Rvfc = (callback: (now: number) => void) => number;
type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: Rvfc;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Silky Apple-Grade Ambient Video Blur (Dual-Kawase WebGL2 Pipeline).
 *
 * Architecture:
 * 1. Half-Float RGBA16F FBOs with fallback to RGBA8: eliminates 8-bit temporal blending banding.
 * 2. Full Dual-Kawase Down + Up pyramid:
 *    Downsample: 256x144 -> 128x72 -> 64x36 -> 32x18 (u_offset = 2.0)
 *    Upsample:   32x18 -> 64x36 -> 128x72 (u_offset = 2.0)
 * 3. Decoupled 15 FPS Video Capture from 60/120 FPS Composition:
 *    Pyramid executes only every ~66ms when video.currentTime changes.
 *    rAF runs at display refresh rate, smoothing temporal transitions using:
 *    const blend = 1 - Math.exp(-dt * 2.8);
 * 4. Composite pass:
 *    - 4-tap B-Spline bicubic lookup over 128x72 texture (1.08x zoom to hide edges)
 *    - Roll off near-black H.264 shadow noise
 *    - Saturation boost (1.42x)
 *    - Soft highlight shoulder for high lyric readability
 *    - Interleaved Gradient Noise (IGN) dithering
 * 5. Strict GPU Hygiene: DPR capped to 1, loop paused on hidden/paused, no CSS blur.
 */

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const DOWN_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_offset;

void main() {
  vec2 halfpixel = 0.5 / u_resolution;
  vec4 sum = texture(u_tex, vUv) * 4.0;
  sum += texture(u_tex, vUv - halfpixel * u_offset);
  sum += texture(u_tex, vUv + halfpixel * u_offset);
  sum += texture(u_tex, vUv + vec2(halfpixel.x, -halfpixel.y) * u_offset);
  sum += texture(u_tex, vUv - vec2(halfpixel.x, -halfpixel.y) * u_offset);
  outColor = sum * 0.125;
}`;

const UP_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_offset;

void main() {
  vec2 halfpixel = 0.5 / u_resolution;
  vec4 sum = vec4(0.0);
  sum += texture(u_tex, vUv + vec2(-halfpixel.x * 2.0, 0.0) * u_offset);
  sum += texture(u_tex, vUv + vec2(-halfpixel.x, halfpixel.y) * u_offset) * 2.0;
  sum += texture(u_tex, vUv + vec2(0.0, halfpixel.y * 2.0) * u_offset);
  sum += texture(u_tex, vUv + vec2(halfpixel.x, halfpixel.y) * u_offset) * 2.0;
  sum += texture(u_tex, vUv + vec2(halfpixel.x * 2.0, 0.0) * u_offset);
  sum += texture(u_tex, vUv + vec2(halfpixel.x, -halfpixel.y) * u_offset) * 2.0;
  sum += texture(u_tex, vUv + vec2(0.0, -halfpixel.y * 2.0) * u_offset);
  sum += texture(u_tex, vUv + vec2(-halfpixel.x, -halfpixel.y) * u_offset) * 2.0;
  outColor = sum / 12.0;
}`;

const TEMPORAL_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_prev;
uniform sampler2D u_tex;
uniform float u_blend;

void main() {
  vec4 prev = texture(u_prev, vUv);
  vec4 curr = texture(u_tex, vUv);
  outColor = mix(prev, curr, clamp(u_blend, 0.0, 1.0));
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_video;
uniform vec2 u_out;
uniform float u_alpha;

// Interleaved Gradient Noise (IGN)
float ign(vec2 p) {
  vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(p, magic.xy)));
}

// 4-tap GPU-accelerated B-Spline bicubic lookup
vec4 sampleBicubic(sampler2D tex, vec2 uv, vec2 texSize) {
  vec2 invTexSize = 1.0 / texSize;
  vec2 tc = uv * texSize - 0.5;
  vec2 f = fract(tc);
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;

  vec2 w0 = -f3 + 3.0 * f2 - 3.0 * f + 1.0;
  vec2 w1 = 3.0 * f3 - 6.0 * f2 + 4.0;
  vec2 w2 = -3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0;
  vec2 w3 = f3;

  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;

  vec2 h0 = (w1 / g0) - 0.5 + (tc - f);
  vec2 h1 = (w3 / g1) + 1.5 + (tc - f);

  vec2 coord00 = vec2(h0.x, h0.y) * invTexSize;
  vec2 coord10 = vec2(h1.x, h0.y) * invTexSize;
  vec2 coord01 = vec2(h0.x, h1.y) * invTexSize;
  vec2 coord11 = vec2(h1.x, h1.y) * invTexSize;

  vec4 tex00 = texture(tex, coord00);
  vec4 tex10 = texture(tex, coord10);
  vec4 tex01 = texture(tex, coord01);
  vec4 tex11 = texture(tex, coord11);

  vec2 w = g1 / (g0 + g1);
  return mix(mix(tex00, tex10, w.x), mix(tex01, tex11, w.x), w.y);
}

void main() {
  // Aspect-ratio cover-fit slightly zoomed 1.08x to hide edge clamping
  float va = u_video.x / max(1.0, u_video.y);
  float oa = u_out.x / max(1.0, u_out.y);
  vec2 s = oa > va ? vec2(1.0, va / oa) : vec2(oa / va, 1.0);
  vec2 uv = (vUv - 0.5) * s / 1.08 + 0.5;

  vec4 raw = sampleBicubic(u_tex, uv, vec2(128.0, 72.0));
  vec3 col = raw.rgb;

  // Roll off near-black H.264 shadow noise
  col = max(col - 0.015, 0.0) * 1.04;

  // Boost saturation (1.42x) for liquid glass color vibrancy
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, 1.42);

  // Soft highlight shoulder so white lyrics stay perfectly legible
  col = col / (1.0 + col * 0.25);
  col *= 0.68;

  // Interleaved Gradient Noise (IGN) dithering to eliminate 8-bit banding
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;

  outColor = vec4(clamp(col, 0.0, 1.0), u_alpha);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader error');
  return sh;
}

function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) {
  const prog = gl.createProgram()!;
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getShaderInfoLog(prog) || 'link error');
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export function MotionFrost(props: {
  video: HTMLVideoElement | null;
  class?: string;
  dim?: number;
  detail?: number;
}) {
  const tier = useTier();
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [flatCanvas, setFlatCanvas] = createSignal<HTMLCanvasElement>();
  const [useGl, setUseGl] = createSignal(typeof WebGL2RenderingContext !== 'undefined');

  /* ---------------------------- WebGL2 Dual-Kawase path ---------------------------- */
  createEffect(() => {
    const el = glCanvas();
    const source = props.video as VideoWithRvfc | null;
    if (!el || !source || !useGl()) return;

    // Strict GPU hygiene: alpha: true for seamless layering over album palette
    const gl = el.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) {
      setUseGl(false);
      return;
    }

    // 1. Detect Half-Float FBO support (EXT_color_buffer_float)
    const extFloat = gl.getExtension('EXT_color_buffer_float');
    const fboInternalFormat = extFloat ? gl.RGBA16F : gl.RGBA8;
    const fboTexType = extFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    let downProgram: WebGLProgram;
    let upProgram: WebGLProgram;
    let temporalProgram: WebGLProgram;
    let compositeProgram: WebGLProgram;

    try {
      downProgram = createProgram(gl, VERT, DOWN_FRAG);
      upProgram = createProgram(gl, VERT, UP_FRAG);
      temporalProgram = createProgram(gl, VERT, TEMPORAL_FRAG);
      compositeProgram = createProgram(gl, VERT, COMPOSITE_FRAG);
    } catch {
      setUseGl(false);
      return;
    }

    // Uniform locations
    const downUniforms = {
      u_tex: gl.getUniformLocation(downProgram, 'u_tex'),
      u_resolution: gl.getUniformLocation(downProgram, 'u_resolution'),
      u_offset: gl.getUniformLocation(downProgram, 'u_offset'),
    };
    const upUniforms = {
      u_tex: gl.getUniformLocation(upProgram, 'u_tex'),
      u_resolution: gl.getUniformLocation(upProgram, 'u_resolution'),
      u_offset: gl.getUniformLocation(upProgram, 'u_offset'),
    };
    const temporalUniforms = {
      u_prev: gl.getUniformLocation(temporalProgram, 'u_prev'),
      u_tex: gl.getUniformLocation(temporalProgram, 'u_tex'),
      u_blend: gl.getUniformLocation(temporalProgram, 'u_blend'),
    };
    const compositeUniforms = {
      u_tex: gl.getUniformLocation(compositeProgram, 'u_tex'),
      u_video: gl.getUniformLocation(compositeProgram, 'u_video'),
      u_out: gl.getUniformLocation(compositeProgram, 'u_out'),
      u_alpha: gl.getUniformLocation(compositeProgram, 'u_alpha'),
    };

    function createFBO(width: number, height: number) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, fboInternalFormat, width, height, 0, gl.RGBA, fboTexType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

      return { fbo, tex, width, height };
    }

    // Allocate Dual-Kawase pyramid FBOs (Down: 256x144 -> 128x72 -> 64x36 -> 32x18, Up: 32x18 -> 64x36 -> 128x72)
    const fbo256 = createFBO(256, 144);
    const fbo128Down = createFBO(128, 72);
    const fbo64Down = createFBO(64, 36);
    const fbo32 = createFBO(32, 18);
    const fbo64Up = createFBO(64, 36);
    const fbo128Result = createFBO(128, 72);

    // Temporal accumulation FBOs (128x72 RGBA16F)
    let temporalPrev = createFBO(128, 72);
    let temporalCurr = createFBO(128, 72);

    // Initial video input texture (RGBA8, 256x144)
    const videoInputTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, videoInputTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let lastCaptureTime = 0;
    let lastVideoTime = -1;
    let lastFrameTime = performance.now();
    let hasCaptured = false;
    let animId = 0;
    let isRunning = false;

    // Helper to render full-screen quad pass
    function renderPass(targetFbo: WebGLFramebuffer | null, w: number, h: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function runKawasePyramid() {
      // 1. Upload video frame to 256x144 texture
      gl.bindTexture(gl.TEXTURE_2D, videoInputTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

      // Pass 1: 256x144 -> 128x72 (Down)
      gl.useProgram(downProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoInputTex);
      gl.uniform1i(downUniforms.u_tex, 0);
      gl.uniform2f(downUniforms.u_resolution, 128, 72);
      gl.uniform1f(downUniforms.u_offset, 2.0);
      renderPass(fbo128Down.fbo, 128, 72);

      // Pass 2: 128x72 -> 64x36 (Down)
      gl.bindTexture(gl.TEXTURE_2D, fbo128Down.tex);
      gl.uniform2f(downUniforms.u_resolution, 64, 36);
      gl.uniform1f(downUniforms.u_offset, 2.0);
      renderPass(fbo64Down.fbo, 64, 36);

      // Pass 3: 64x36 -> 32x18 (Down)
      gl.bindTexture(gl.TEXTURE_2D, fbo64Down.tex);
      gl.uniform2f(downUniforms.u_resolution, 32, 18);
      gl.uniform1f(downUniforms.u_offset, 2.0);
      renderPass(fbo32.fbo, 32, 18);

      // Pass 4: 32x18 -> 64x36 (Up)
      gl.useProgram(upProgram);
      gl.bindTexture(gl.TEXTURE_2D, fbo32.tex);
      gl.uniform1i(upUniforms.u_tex, 0);
      gl.uniform2f(upUniforms.u_resolution, 64, 36);
      gl.uniform1f(upUniforms.u_offset, 2.0);
      renderPass(fbo64Up.fbo, 64, 36);

      // Pass 5: 64x36 -> 128x72 (Up)
      gl.bindTexture(gl.TEXTURE_2D, fbo64Up.tex);
      gl.uniform2f(upUniforms.u_resolution, 128, 72);
      gl.uniform1f(upUniforms.u_offset, 2.0);
      renderPass(fbo128Result.fbo, 128, 72);

      hasCaptured = true;
    }

    const render = (now: number) => {
      if (!isRunning) return;

      // Strict GPU Hygiene: pause rAF loop when document is hidden or video is paused
      if (document.hidden || source.paused || source.ended) {
        isRunning = false;
        return;
      }

      // Decouple 15 FPS Video Capture from 60/120 FPS Composition:
      // Only run Dual-Kawase pyramid at ~15 FPS (every ~66ms AND only when video time has advanced)
      if (
        now - lastCaptureTime >= 66 &&
        source.readyState >= 2 &&
        source.videoWidth > 0 &&
        source.currentTime !== lastVideoTime
      ) {
        lastCaptureTime = now;
        lastVideoTime = source.currentTime;
        try {
          runKawasePyramid();
        } catch {
          // Ignore upload edge case
        }
      }

      if (hasCaptured) {
        const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
        lastFrameTime = now;

        // Frame-rate-independent exponential decay: const blend = 1 - Math.exp(-dt * 2.8);
        const blend = 1.0 - Math.exp(-dt * 2.8);

        // Temporal Accumulation Pass (128x72 RGBA16F)
        gl.useProgram(temporalProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, temporalPrev.tex);
        gl.uniform1i(temporalUniforms.u_prev, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, fbo128Result.tex);
        gl.uniform1i(temporalUniforms.u_tex, 1);

        gl.uniform1f(temporalUniforms.u_blend, blend);
        renderPass(temporalCurr.fbo, 128, 72);

        // Ping-pong temporal buffers
        const tmp = temporalPrev;
        temporalPrev = temporalCurr;
        temporalCurr = tmp;

        // Strict GPU hygiene: Cap canvas DPR to 1 (never Retina 2x/3x)
        const dprW = Math.max(1, Math.round(el.clientWidth || window.innerWidth));
        const dprH = Math.max(1, Math.round(el.clientHeight || window.innerHeight));
        if (el.width !== dprW || el.height !== dprH) {
          el.width = dprW;
          el.height = dprH;
        }

        // Composite Pass to Canvas (4-Tap B-Spline Bicubic + Liquid-Glass Grading + IGN Dither)
        gl.useProgram(compositeProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, temporalPrev.tex);
        gl.uniform1i(compositeUniforms.u_tex, 0);

        gl.uniform2f(compositeUniforms.u_video, source.videoWidth || 128, source.videoHeight || 72);
        gl.uniform2f(compositeUniforms.u_out, el.width, el.height);
        gl.uniform1f(compositeUniforms.u_alpha, props.dim ? Math.max(0.35, 1.0 - props.dim * 0.8) : 0.68);

        renderPass(null, el.width, el.height);
      } else {
        lastFrameTime = now;
      }

      animId = requestAnimationFrame(render);
    };

    const startLoop = () => {
      if (isRunning || document.hidden || source.paused || source.ended) return;
      isRunning = true;
      lastFrameTime = performance.now();
      animId = requestAnimationFrame(render);
    };

    const stopLoop = () => {
      isRunning = false;
      cancelAnimationFrame(animId);
    };

    source.addEventListener('play', startLoop);
    source.addEventListener('playing', startLoop);
    source.addEventListener('pause', stopLoop);
    source.addEventListener('waiting', stopLoop);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopLoop();
      else startLoop();
    });

    startLoop();

    onCleanup(() => {
      stopLoop();
      source.removeEventListener('play', startLoop);
      source.removeEventListener('playing', startLoop);
      source.removeEventListener('pause', stopLoop);
      source.removeEventListener('waiting', stopLoop);

      // Clean up WebGL resources
      const fbos = [fbo256, fbo128Down, fbo64Down, fbo32, fbo64Up, fbo128Result, temporalPrev, temporalCurr];
      for (const item of fbos) {
        gl.deleteFramebuffer(item.fbo);
        gl.deleteTexture(item.tex);
      }
      gl.deleteTexture(videoInputTex);
      gl.deleteProgram(downProgram);
      gl.deleteProgram(upProgram);
      gl.deleteProgram(temporalProgram);
      gl.deleteProgram(compositeProgram);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    });
  });

  /* ------------------------------ 2D fallback ------------------------------ */
  createEffect(() => {
    const el = flatCanvas();
    const source = props.video as VideoWithRvfc | null;
    const frostFps = tier.frostFps;
    if (!el || !source || frostFps <= 0 || useGl()) return;

    // Draw into a 32x18 canvas with imageSmoothingQuality = 'high' and CSS-scale it up instead of CSS filter:blur
    const ctx = el.getContext('2d', { alpha: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let animId = 0;
    let isRunning = false;
    let lastTime = 0;
    const gap = 1000 / Math.min(frostFps, 15);

    const step = (now: number) => {
      if (!isRunning || document.hidden || source.paused) {
        isRunning = false;
        return;
      }
      if (now - lastTime >= gap && source.readyState >= 2 && source.videoWidth > 0) {
        lastTime = now;
        try {
          ctx.drawImage(source, 0, 0, 32, 18);
        } catch {}
      }
      animId = requestAnimationFrame(step);
    };

    const start = () => {
      if (isRunning || document.hidden || source.paused) return;
      isRunning = true;
      animId = requestAnimationFrame(step);
    };
    const stop = () => {
      isRunning = false;
      cancelAnimationFrame(animId);
    };

    source.addEventListener('play', start);
    source.addEventListener('playing', start);
    source.addEventListener('pause', stop);
    start();

    onCleanup(() => {
      stop();
      source.removeEventListener('play', start);
      source.removeEventListener('playing', start);
      source.removeEventListener('pause', stop);
    });
  });

  return (
    <div class={`absolute inset-0 overflow-hidden bg-transparent ${props.class ?? ''}`} aria-hidden="true">
      <Show
        when={useGl()}
        fallback={
          <canvas
            ref={setFlatCanvas}
            width={32}
            height={18}
            class="absolute inset-0 size-full object-cover scale-[1.08]"
            style={{
              'will-change': 'transform',
              contain: 'strict',
              'pointer-events': 'none',
            }}
          />
        }
      >
        <canvas
          ref={setGlCanvas}
          class="absolute inset-0 size-full object-cover"
          style={{
            'will-change': 'transform',
            contain: 'strict',
            'pointer-events': 'none',
          }}
        />
      </Show>
    </div>
  );
}
