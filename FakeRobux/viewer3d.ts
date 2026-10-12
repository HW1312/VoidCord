/*
 * FakeRobux – small WebGL viewer for Roblox's 3D avatar export (OBJ + MTL + PNG textures), orbit like on roblox.com.
 * No three.js: the export is plain triangles with one texture per material, so a tiny shader is enough.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Vec3 { x: number; y: number; z: number; }

export interface AvatarModel {
    obj: string;
    mtl: string;
    /** texture hash → data URL */
    textures: Record<string, string>;
    aabb: { min: Vec3; max: Vec3; };
}

interface Material { color: [number, number, number]; texture?: string; }

/** One draw call: interleaved position (3), uv (2), normal (3) */
interface Batch { material: string; data: Float32Array; }

// ---------------------------------------------------------------- Parsing

export function parseMtl(src: string) {
    const out = new Map<string, Material>();
    let cur: Material | null = null;
    for (const raw of src.split("\n")) {
        const p = raw.trim().split(/\s+/);
        if (p[0] === "newmtl") out.set(p[1], cur = { color: [1, 1, 1] });
        else if (!cur) continue;
        else if (p[0] === "Kd") cur.color = [+p[1], +p[2], +p[3]];
        else if (p[0] === "map_Kd") cur.texture = p[1];
    }
    return out;
}

export function parseObj(src: string): Batch[] {
    const pos: number[] = [];
    const uv: number[] = [];
    const nrm: number[] = [];
    const groups = new Map<string, number[]>();
    let cur: number[] = [];
    groups.set("", cur);

    const push = (vert: string) => {
        const [a, b, c] = vert.split("/");
        const pi = (+a < 0 ? pos.length / 3 + +a : +a - 1) * 3;
        cur.push(pos[pi], pos[pi + 1], pos[pi + 2]);
        if (b) {
            const ti = (+b < 0 ? uv.length / 2 + +b : +b - 1) * 2;
            cur.push(uv[ti], uv[ti + 1]);
        } else cur.push(0, 0);
        if (c) {
            const ni = (+c < 0 ? nrm.length / 3 + +c : +c - 1) * 3;
            cur.push(nrm[ni], nrm[ni + 1], nrm[ni + 2]);
        } else cur.push(0, 1, 0);
    };

    for (const raw of src.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("v ")) {
            const p = line.split(/\s+/);
            pos.push(+p[1], +p[2], +p[3]);
        } else if (line.startsWith("vt ")) {
            const p = line.split(/\s+/);
            uv.push(+p[1], +p[2]);
        } else if (line.startsWith("vn ")) {
            const p = line.split(/\s+/);
            nrm.push(+p[1], +p[2], +p[3]);
        } else if (line.startsWith("usemtl ")) {
            const name = line.slice(7).trim();
            cur = groups.get(name) ?? [];
            groups.set(name, cur);
        } else if (line.startsWith("f ")) {
            const v = line.split(/\s+/).slice(1);
            // Polygons → triangle fan
            for (let i = 1; i + 1 < v.length; i++) {
                push(v[0]);
                push(v[i]);
                push(v[i + 1]);
            }
        }
    }

    return [...groups].filter(([, d]) => d.length).map(([material, d]) => ({ material, data: new Float32Array(d) }));
}

// ---------------------------------------------------------------- Math (column-major 4×4)

function perspective(fovY: number, aspect: number, near: number, far: number) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function lookAt(eye: number[], center: number[], up: number[]) {
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = norm(sub(eye, center));
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

function multiply(a: number[], b: number[]) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
}

// ---------------------------------------------------------------- Renderer

const VS = `#version 300 es
in vec3 aPos;
in vec2 aUv;
in vec3 aNrm;
uniform mat4 uMvp;
out vec2 vUv;
out vec3 vNrm;
void main() {
    vUv = aUv;
    vNrm = aNrm;
    gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vNrm;
uniform sampler2D uTex;
uniform bool uHasTex;
uniform vec3 uColor;
uniform vec3 uLight;
out vec4 outColor;
void main() {
    vec4 c = uHasTex ? texture(uTex, vUv) : vec4(uColor, 1.0);
    if (c.a < 0.5) discard;
    vec3 n = normalize(vNrm);
    if (!gl_FrontFacing) n = -n;
    float key = max(dot(n, uLight), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    outColor = vec4(c.rgb * (0.42 + 0.5 * key + 0.18 * sky), 1.0);
}`;

function shader(gl: WebGL2RenderingContext, type: number, src: string) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "Shader error");
    return s;
}

function loadImage(src: string) {
    const img = new Image();
    img.src = src;
    return img.decode().then(() => img);
}

/** Orbit camera state; yaw 0 = looking at the avatar's face */
export interface View { yaw: number; pitch: number; zoom: number; }

export class AvatarRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;
    private draws: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number; texture: WebGLTexture | null; color: [number, number, number]; }[] = [];
    private textures: WebGLTexture[] = [];
    private center: number[];
    private radius: number;
    private uniforms: Record<string, WebGLUniformLocation | null> = {};

    private constructor(private canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
        if (!gl) throw new Error("WebGL 2 isn't available");
        this.gl = gl;
        const p = gl.createProgram()!;
        gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "Link error");
        this.program = p;
        for (const u of ["uMvp", "uTex", "uHasTex", "uColor", "uLight"]) this.uniforms[u] = gl.getUniformLocation(p, u);
        this.center = [0, 0, 0];
        this.radius = 1;
    }

    static async create(canvas: HTMLCanvasElement, model: AvatarModel) {
        const r = new AvatarRenderer(canvas);
        await r.load(model);
        return r;
    }

    private async load(model: AvatarModel) {
        const { gl } = this;
        const { min, max } = model.aabb;
        this.center = [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2];
        this.radius = Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2;

        const materials = parseMtl(model.mtl);
        const texByHash = new Map<string, WebGLTexture>();
        await Promise.all(Object.entries(model.textures).map(async ([hash, url]) => {
            const img = await loadImage(url).catch(() => null);
            if (!img) return;
            const t = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            texByHash.set(hash, t);
            this.textures.push(t);
        }));

        const aPos = gl.getAttribLocation(this.program, "aPos");
        const aUv = gl.getAttribLocation(this.program, "aUv");
        const aNrm = gl.getAttribLocation(this.program, "aNrm");
        for (const batch of parseObj(model.obj)) {
            const mat = materials.get(batch.material);
            const vao = gl.createVertexArray()!;
            const buffer = gl.createBuffer()!;
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 32, 0);
            gl.enableVertexAttribArray(aUv);
            gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 32, 12);
            gl.enableVertexAttribArray(aNrm);
            gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 32, 20);
            this.draws.push({
                vao,
                buffer,
                count: batch.data.length / 8,
                texture: (mat?.texture && texByHash.get(mat.texture)) || null,
                color: mat?.color ?? [0.64, 0.64, 0.65]
            });
        }
        gl.bindVertexArray(null);
    }

    render(view: View) {
        const { gl, canvas } = this;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);

        // Roblox avatars face -Z
        const fov = (30 * Math.PI) / 180;
        const dist = (this.radius / Math.sin(fov / 2)) * 1.08 / view.zoom;
        const dir = [Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), -Math.cos(view.yaw) * Math.cos(view.pitch)];
        const eye = [this.center[0] + dir[0] * dist, this.center[1] + dir[1] * dist, this.center[2] + dir[2] * dist];
        const mvp = multiply(perspective(fov, w / h, dist / 50, dist * 4), lookAt(eye, this.center, [0, 1, 0]));

        // Key light from the camera, a bit from above and the left
        const l = [dir[0] + Math.cos(view.yaw) * 0.4, dir[1] + 0.7, dir[2] + Math.sin(view.yaw) * 0.4];
        const ll = Math.hypot(l[0], l[1], l[2]);

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uniforms.uMvp, false, mvp);
        gl.uniform3f(this.uniforms.uLight, l[0] / ll, l[1] / ll, l[2] / ll);
        gl.uniform1i(this.uniforms.uTex, 0);
        gl.activeTexture(gl.TEXTURE0);
        for (const d of this.draws) {
            gl.uniform1i(this.uniforms.uHasTex, d.texture ? 1 : 0);
            gl.uniform3f(this.uniforms.uColor, d.color[0], d.color[1], d.color[2]);
            gl.bindTexture(gl.TEXTURE_2D, d.texture);
            gl.bindVertexArray(d.vao);
            gl.drawArrays(gl.TRIANGLES, 0, d.count);
        }
        gl.bindVertexArray(null);
    }

    dispose() {
        const { gl } = this;
        for (const d of this.draws) {
            gl.deleteVertexArray(d.vao);
            gl.deleteBuffer(d.buffer);
        }
        for (const t of this.textures) gl.deleteTexture(t);
        gl.deleteProgram(this.program);
        this.draws = [];
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
}
