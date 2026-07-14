import {
  BLUR_DOWNSCALE,
  BLUR_RADIUS_PX,
  BLUR_TEXEL_SCALE,
  MASK_EDGE_HIGH,
  MASK_EDGE_LOW,
} from "@/lib/calls/backgroundBlur/constants";

const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const PASSTHROUGH_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main() {
  outColor = texture(u_tex, v_uv);
}
`;

const BLUR_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;
uniform float u_radius;
out vec4 outColor;

void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  const int SAMPLES = 13;
  for (int i = 0; i < SAMPLES; i++) {
    float s = float(i) - 6.0;
    float w = exp(-0.5 * (s * s) / (u_radius * u_radius + 0.001));
    vec2 offset = u_direction * s;
    sum += texture(u_tex, v_uv + offset) * w;
    total += w;
  }
  outColor = sum / total;
}
`;

const COMPOSITE_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_video;
uniform sampler2D u_blurred;
uniform sampler2D u_mask;
uniform float u_edgeLow;
uniform float u_edgeHigh;
out vec4 outColor;

void main() {
  float m = texture(u_mask, v_uv).r;
  float t = clamp((m - u_edgeLow) / (u_edgeHigh - u_edgeLow), 0.0, 1.0);
  float alpha = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  vec3 sharp = texture(u_video, v_uv).rgb;
  vec3 blurred = texture(u_blurred, v_uv).rgb;
  outColor = vec4(mix(blurred, sharp, alpha), 1.0);
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown";
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Failed to create texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function createFbo(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
  const tex = createTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error("Failed to create framebuffer");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex };
}

export type WebGLBackgroundBlurCompositor = {
  resize: (width: number, height: number) => void;
  render: (video: HTMLVideoElement, mask: Float32Array) => void;
  renderSharp: (video: HTMLVideoElement) => void;
  destroy: () => void;
};

export function createWebGLBackgroundBlurCompositor(
  canvas: HTMLCanvasElement,
): WebGLBackgroundBlurCompositor {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error("WebGL2 not available");

  const quadBuffer = gl.createBuffer();
  if (!quadBuffer) throw new Error("Failed to create buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const passthroughProgram = createProgram(gl, VERTEX_SRC, PASSTHROUGH_FRAG);
  const blurProgram = createProgram(gl, VERTEX_SRC, BLUR_FRAG);
  const compositeProgram = createProgram(gl, VERTEX_SRC, COMPOSITE_FRAG);

  const passPosLoc = gl.getAttribLocation(passthroughProgram, "a_pos");
  const blurPosLoc = gl.getAttribLocation(blurProgram, "a_pos");
  const compPosLoc = gl.getAttribLocation(compositeProgram, "a_pos");

  const videoTex = createTexture(gl);
  const maskTex = createTexture(gl);

  let outputW = 0;
  let outputH = 0;
  let blurW = 0;
  let blurH = 0;
  let blurFboA: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  let blurFboB: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;

  const bindQuad = (program: WebGLProgram, posLoc: number) => {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  };

  let maskR8Buffer: Uint8Array | null = null;

  const uploadVideo = (video: HTMLVideoElement) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  };

  /** R8 mask upload — R32F is often unsupported in fragment shaders (reads as 0 → full blur). */
  const uploadMask = (mask: Float32Array) => {
    const len = outputW * outputH;
    if (!maskR8Buffer || maskR8Buffer.length < len) {
      maskR8Buffer = new Uint8Array(len);
    }
    const bytes = maskR8Buffer;
    for (let i = 0; i < len; i++) {
      const v = mask[i] ?? 0;
      bytes[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      outputW,
      outputH,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      bytes.subarray(0, len),
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  };

  const runBlurPass = (
    inputTex: WebGLTexture,
    targetFbo: WebGLFramebuffer,
    direction: [number, number],
  ) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
    gl.viewport(0, 0, blurW, blurH);
    bindQuad(blurProgram, blurPosLoc);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.uniform1i(gl.getUniformLocation(blurProgram, "u_tex"), 0);
    gl.uniform2fv(gl.getUniformLocation(blurProgram, "u_direction"), direction);
    gl.uniform1f(gl.getUniformLocation(blurProgram, "u_radius"), BLUR_RADIUS_PX);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const resize = (width: number, height: number) => {
    if (width === outputW && height === outputH) return;
    outputW = width;
    outputH = height;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);

    blurW = Math.max(1, Math.round(width * BLUR_DOWNSCALE));
    blurH = Math.max(1, Math.round(height * BLUR_DOWNSCALE));

    if (blurFboA) {
      gl.deleteFramebuffer(blurFboA.fbo);
      gl.deleteTexture(blurFboA.tex);
    }
    if (blurFboB) {
      gl.deleteFramebuffer(blurFboB.fbo);
      gl.deleteTexture(blurFboB.tex);
    }
    blurFboA = createFbo(gl, blurW, blurH);
    blurFboB = createFbo(gl, blurW, blurH);
  };

  const render = (video: HTMLVideoElement, mask: Float32Array) => {
    if (!blurFboA || !blurFboB || outputW === 0 || outputH === 0) return;

    uploadVideo(video);
    uploadMask(mask);

    const invW = 1 / blurW;
    const invH = 1 / blurH;

    // Downscale video into blur buffer A
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboA.fbo);
    gl.viewport(0, 0, blurW, blurH);
    bindQuad(passthroughProgram, passPosLoc);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.uniform1i(gl.getUniformLocation(passthroughProgram, "u_tex"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const texelX = invW * BLUR_RADIUS_PX * BLUR_TEXEL_SCALE;
    const texelY = invH * BLUR_RADIUS_PX * BLUR_TEXEL_SCALE;
    runBlurPass(blurFboA.tex, blurFboB.fbo, [texelX, 0]);
    runBlurPass(blurFboB.tex, blurFboA.fbo, [0, texelY]);

    // Composite at full resolution
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outputW, outputH);
    bindQuad(compositeProgram, compPosLoc);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.uniform1i(gl.getUniformLocation(compositeProgram, "u_video"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurFboA.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(compositeProgram, "u_blurred"), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(gl.getUniformLocation(compositeProgram, "u_mask"), 2);

    gl.uniform1f(
      gl.getUniformLocation(compositeProgram, "u_edgeLow"),
      MASK_EDGE_LOW,
    );
    gl.uniform1f(
      gl.getUniformLocation(compositeProgram, "u_edgeHigh"),
      MASK_EDGE_HIGH,
    );

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const renderSharp = (video: HTMLVideoElement) => {
    if (outputW === 0 || outputH === 0) return;
    uploadVideo(video);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outputW, outputH);
    bindQuad(passthroughProgram, passPosLoc);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.uniform1i(gl.getUniformLocation(passthroughProgram, "u_tex"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const destroy = () => {
    if (blurFboA) {
      gl.deleteFramebuffer(blurFboA.fbo);
      gl.deleteTexture(blurFboA.tex);
    }
    if (blurFboB) {
      gl.deleteFramebuffer(blurFboB.fbo);
      gl.deleteTexture(blurFboB.tex);
    }
    gl.deleteTexture(videoTex);
    gl.deleteTexture(maskTex);
    gl.deleteBuffer(quadBuffer);
    gl.deleteProgram(passthroughProgram);
    gl.deleteProgram(blurProgram);
    gl.deleteProgram(compositeProgram);
  };

  return { resize, render, renderSharp, destroy };
}

export function isWebGL2Available(): boolean {
  if (typeof document === "undefined") return false;
  const c = document.createElement("canvas");
  return !!c.getContext("webgl2");
}
