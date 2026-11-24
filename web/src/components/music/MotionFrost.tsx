import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { useTier } from '@/lib/perf';

type Rvfc = (callback: (now: number) => void) => number;
type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: Rvfc;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * A frosted copy of a playing video, the way Apple Music's lyrics view looks, done on the GPU.
 *
 * Every frame of the *same* <video> is uploaded as a WebGL2 texture, a full mip chain is built,
 * and one fragment pass reads a deep mip level through a wide tent kernel. That is a real
 * multi-scale Gaussian: silky gradients with no video compression blocks, no stepped canvas
 * downscales and no CSS blur on a layer that changes every frame (which is what made it lag).
 * Colour is lifted (saturation, a touch of contrast), a soft veil keeps the page readable, and a
 * triangular dither of one 8-bit step removes banding. Each frame is blended over the last one
 * (a short temporal average), so the motion drifts instead of flickering.
 *
 * Where WebGL2 is missing, or the video's frames cannot be uploaded, the same look is drawn the
 * old way: staged 2D downscales and one CSS blur.
 */

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uVideo;   // video size in px
uniform vec2 uOut;     // output size in px
uniform float uLod;    // mip level the blur reads
uniform float uDim;    // 0..1 veil strength
uniform float uAlpha;  // blend over the previous frame
uniform float uSeed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453);
}

void main() {
  // cover-fit with a little zoom so the soft edge of the blur never shows
  float va = uVideo.x / uVideo.y;
  float oa = uOut.x / uOut.y;
  vec2 s = oa > va ? vec2(1.0, va / oa) : vec2(oa / va, 1.0);
  vec2 uv = (vUv - 0.5) * s / 1.12 + 0.5;

  // 13-tap tent on a deep mip level: wide, smooth and free of block edges
  float t = exp2(uLod) / uVideo.x;
  vec3 c = textureLod(uTex, uv, uLod).rgb * 0.22;
  for (int i = 0; i < 6; i++) {
    float a = 1.0471976 * float(i);
    vec2 d = vec2(cos(a), sin(a)) * vec2(1.0, uVideo.x / uVideo.y);
    c += textureLod(uTex, uv + d * t * 1.25, uLod).rgb * 0.09;
    c += textureLod(uTex, uv + d * t * 2.6, uLod + 1.0).rgb * 0.0433;
  }

  // Ultra-clean ambient liquid glass: preserve rich, authentic color hues and saturation
  // Soft, smooth luminous scaling prevents dirty grey wash while ensuring text readability
  float veil = clamp(uDim * 0.45 + vUv.y * 0.22, 0.0, 0.6);
  c = c * (1.0 - veil * 0.5);

  // Pure modern liquid glass: zero noise grain, natural authentic video colors
  outColor = vec4(clamp(c, 0.0, 1.0), uAlpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
  return sh;
}

export function MotionFrost(props: {
  video: HTMLVideoElement | null;
  class?: string;
  /** 0–1: how much black is laid over the blur, so light posters never wash the page. */
  dim?: number;
  /** Width in px of the colour field that is read: 32 = pure colour, 120 = the video is faintly visible. */
  detail?: number;
}) {
  const tier = useTier();
  const [glCanvas, setGlCanvas] = createSignal<HTMLCanvasElement>();
  const [flatCanvas, setFlatCanvas] = createSignal<HTMLCanvasElement>();
  const [useGl, setUseGl] = createSignal(typeof WebGL2RenderingContext !== 'undefined');

  /* ---------------------------- WebGL2 path ---------------------------- */
  createEffect(() => {
    const el = glCanvas();
    const source = props.video as VideoWithRvfc | null;
    const fps = tier.frostFps;
    if (!el || !source || fps <= 0 || !useGl()) return;
    const gl = el.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    if (!gl) {
      setUseGl(false);
      return;
    }
    let program: WebGLProgram;
    let texture: WebGLTexture;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
    } catch {
      setUseGl(false);
      return;
    }
    gl.useProgram(program);
    texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const uLod = gl.getUniformLocation(program, 'uLod')!;
    const uDim = gl.getUniformLocation(program, 'uDim')!;
    const uAlpha = gl.getUniformLocation(program, 'uAlpha')!;
    const uSeed = gl.getUniformLocation(program, 'uSeed')!;
    const uVideo = gl.getUniformLocation(program, 'uVideo')!;
    const uOut = gl.getUniformLocation(program, 'uOut')!;
    gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
    gl.uniform2f(uOut, el.width, el.height);
    gl.viewport(0, 0, el.width, el.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Ambient lighting updates fluidly at 24 FPS with temporal alpha blending:
    // eliminates GPU pipeline stalls while looking organic and smooth
    const ambientFps = Math.min(fps, 24);
    const gap = 1000 / ambientFps;
    let last = 0;
    let handle = 0;
    let stopped = false;
    let primed = false;

    const step = (now: number) => {
      if (stopped) return;
      if (!document.hidden && now - last >= gap - 3 && source.readyState >= 2 && source.videoWidth > 0) {
        last = now;
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
          gl.generateMipmap(gl.TEXTURE_2D);
          const vw = source.videoWidth;
          gl.uniform2f(uVideo, vw, source.videoHeight);
          // High-resolution liquid glass mip level: pure optical video blur without 32px macroblocks
          gl.uniform1f(uLod, Math.max(0, Math.log2(vw / (props.detail ?? 180))));
          gl.uniform1f(uDim, props.dim ?? 0.42);
          gl.uniform1f(uAlpha, primed ? 0.4 : 1);
          gl.uniform1f(uSeed, (now % 1000) / 1000);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          primed = true;
        } catch {
          // Frames that cannot be uploaded (a cross-origin source without CORS): use the 2D path.
          stopped = true;
          setUseGl(false);
          return;
        }
      }
      schedule();
    };
    const schedule = () => {
      handle = source.requestVideoFrameCallback
        ? source.requestVideoFrameCallback(step)
        : requestAnimationFrame(step);
    };
    schedule();
    onCleanup(() => {
      stopped = true;
      if (source.cancelVideoFrameCallback) source.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    });
  });

  /* ------------------------------ 2D fallback ------------------------------ */
  createEffect(() => {
    const el = flatCanvas();
    const source = props.video as VideoWithRvfc | null;
    const frostFps = tier.frostFps;
    if (!el || !source || frostFps <= 0 || useGl()) return;
    const ctx = el.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const W = el.width;
    const H = el.height;
    const stage = [4, 2].map((k) => {
      const c = document.createElement('canvas');
      c.width = W * k;
      c.height = H * k;
      const cx = c.getContext('2d', { alpha: false });
      if (cx) {
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
      }
      return { c, cx };
    });
    let primed = false;
    const gap = 1000 / frostFps;
    let last = 0;
    let handle = 0;
    let stopped = false;
    const step = (now: number) => {
      if (stopped) return;
      if (!document.hidden && now - last >= gap - 3 && source.readyState >= 2 && source.videoWidth > 0) {
        last = now;
        try {
          let from: CanvasImageSource = source;
          for (const { c, cx } of stage) {
            if (!cx) break;
            cx.drawImage(from, 0, 0, c.width, c.height);
            from = c;
          }
          ctx.globalAlpha = primed ? 0.4 : 1;
          ctx.drawImage(from, 0, 0, W, H);
          ctx.globalAlpha = 1;
          primed = true;
        } catch {
          // a frame that cannot be read is skipped
        }
      }
      schedule();
    };
    const schedule = () => {
      handle = source.requestVideoFrameCallback
        ? source.requestVideoFrameCallback(step)
        : requestAnimationFrame(step);
    };
    schedule();
    onCleanup(() => {
      stopped = true;
      if (source.cancelVideoFrameCallback) source.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    });
  });

  const dim = () => props.dim ?? 0.42;
  return (
    <div class={`absolute inset-0 overflow-hidden bg-[#07070b] ${props.class ?? ''}`} aria-hidden="true">
      <Show
        when={useGl()}
        fallback={
          <>
            <canvas
              ref={setFlatCanvas}
              width={tier.frostSize[0]}
              height={tier.frostSize[1]}
              class={`absolute inset-0 size-full object-cover ${
                tier.blur ? '[filter:blur(40px)] [transform:translateZ(0)_scale(1.14)]' : 'scale-[1.12]'
              }`}
            />
            <div
              class="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, rgba(6,6,10,${(dim() * 0.8).toFixed(3)}) 0%, rgba(6,6,10,${(
                  dim() + 0.32
                ).toFixed(3)}) 100%)`,
              }}
            />
          </>
        }
      >
        <canvas ref={setGlCanvas} width={1280} height={720} class="absolute inset-0 size-full object-cover" />
      </Show>
    </div>
  );
}
