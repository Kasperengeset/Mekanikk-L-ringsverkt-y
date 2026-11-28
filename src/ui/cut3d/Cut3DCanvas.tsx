/**
 * 3D-tegningen av snittet med three.js. Lastes først når studenten legger et snitt (React.lazy i
 * CutCard), så resten av appen ikke venter på biblioteket.
 *
 * Scenen (scene.ts) gjøres om til objekter hver gang den endres; kameraet beholdes, så snittet kan
 * dras i konstruksjonen mens figuren står stille. `viewKey` setter kameraet tilbake (ny visning,
 * «Tilbakestill visning»). I spenningsvisningen følger kameraet snittet når det flyttes.
 *
 * Tegnes bare ved endring (dra, zoom, ny scene), ikke i en løkke. Etikettene er HTML (CSS2DRenderer).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { DisplaySection, Scene3D, SceneArc, SceneArrow, SceneBody, SceneLabel, SceneSupport, Tone, V3 } from "./scene.js";

const FOV = 32;

/** Fargene fra styles.css, med faste verdier som reserve. */
function readColors(): Record<Tone | "member" | "memberEdge" | "face" | "faceEdge" | "support", string> {
  const css = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : undefined;
  const v = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback;
  return {
    load: v("--load", "#2a1b12"),
    loadPoint: v("--load-point", "#e2682b"),
    reaction: v("--reaction", "#7b4f8e"),
    N: v("--diagram-N", "#3d6b8c"),
    V: v("--diagram-V", "#5c7a3e"),
    M: v("--diagram-M", "#e2682b"),
    tension: v("--tension", "#c4511a"),
    compression: v("--compression", "#3d6b8c"),
    tau: v("--diagram-V", "#5c7a3e"),
    muted: v("--muted", "#6b5b4e"),
    member: v("--member-3d", "#efe7da"),
    memberEdge: v("--line-hover", "#b9a892"),
    face: v("--accent-soft", "#fbe3d5"),
    faceEdge: v("--accent", "#e2682b"),
    support: v("--faint", "#8a7b6e"),
  };
}

const vec = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

/** Basis med lokal x → a, y → b, z → c (c = a × b). */
function basis(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, origin: THREE.Vector3) {
  return new THREE.Matrix4().makeBasis(a, b, c).setPosition(origin);
}

/** Tverrsnittet som flater i (y', z): x i formen er y', y er z. */
function sectionShapes(section: DisplaySection): THREE.Shape[] {
  if (section.kind === "circle") {
    const shape = new THREE.Shape().absarc(0, 0, section.R, 0, Math.PI * 2, false);
    if (section.r > 0) shape.holes.push(new THREE.Path().absarc(0, 0, section.r, 0, Math.PI * 2, true));
    return [shape];
  }
  return section.rects.map((r) => new THREE.Shape([new THREE.Vector2(r.y0, r.z0), new THREE.Vector2(r.y1, r.z0), new THREE.Vector2(r.y1, r.z1), new THREE.Vector2(r.y0, r.z1)]));
}

class Builder {
  readonly group = new THREE.Group();
  readonly labels = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private materials = new Map<string, THREE.Material>();
  private lineMaterials: LineMaterial[] = [];
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 18, 1);
  private readonly cone = new THREE.ConeGeometry(1, 1, 22, 1);

  constructor(
    private colors: ReturnType<typeof readColors>,
    private size: { width: number; height: number },
  ) {}

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private material(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.materials.get(key);
    if (!m) this.materials.set(key, (m = make()));
    return m;
  }

  private solid(color: string, opacity = 1) {
    return this.material(`solid:${color}:${opacity}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, transparent: opacity < 1, opacity, depthWrite: opacity === 1 }));
  }

  private edges(geometry: THREE.BufferGeometry, color: string, opacity: number, matrix: THREE.Matrix4) {
    const lines = new THREE.LineSegments(
      this.track(new THREE.EdgesGeometry(geometry, 25)),
      this.material(`edge:${color}:${opacity}`, () => new THREE.LineBasicMaterial({ color, transparent: true, opacity })),
    );
    lines.applyMatrix4(matrix);
    this.group.add(lines);
  }

  body(b: SceneBody) {
    const geometry = this.track(new THREE.ExtrudeGeometry(sectionShapes(b.section), { depth: b.length, bevelEnabled: false, curveSegments: 28 }));
    const matrix = basis(vec(b.up), new THREE.Vector3(0, 0, 1), vec(b.dir), vec(b.origin));
    const mesh = new THREE.Mesh(geometry, this.solid(this.colors.member));
    mesh.applyMatrix4(matrix);
    this.group.add(mesh);
    this.edges(geometry, this.colors.memberEdge, 0.9, matrix);
  }

  face(center: V3, normal: V3, up: V3, section: DisplaySection, span: number) {
    const geometry = this.track(new THREE.ShapeGeometry(sectionShapes(section), 28));
    const n = vec(normal);
    const origin = vec(center).addScaledVector(n, 0.0008 * span);
    // ShapeGeometry ligger i lokal xy; z → normalen. Basisen kan bli venstrehendt, derfor DoubleSide.
    const matrix = basis(vec(up), new THREE.Vector3(0, 0, 1), n, origin);
    const mat = this.material("face", () => new THREE.MeshStandardMaterial({ color: this.colors.face, roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.applyMatrix4(matrix);
    this.group.add(mesh);
    this.edges(geometry, this.colors.faceEdge, 1, matrix);
  }

  arrow(a: SceneArrow) {
    const tail = vec(a.tail);
    const tip = vec(a.tip);
    const d = tip.clone().sub(tail);
    const len = d.length();
    if (len < 1e-12) return;
    d.divideScalar(len);
    const headLen = Math.min(len * 0.45, a.radius * 5.5);
    const headR = a.radius * 2.5;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const mat = this.solid(this.colors[a.tone]);
    const shaftLen = len - headLen;
    if (shaftLen > 0) {
      const shaft = new THREE.Mesh(this.cylinder, mat);
      shaft.scale.set(a.radius, shaftLen, a.radius);
      shaft.quaternion.copy(q);
      shaft.position.copy(tail).addScaledVector(d, shaftLen / 2);
      this.group.add(shaft);
    }
    const head = new THREE.Mesh(this.cone, mat);
    head.scale.set(headR, headLen, headR);
    head.quaternion.copy(q);
    head.position.copy(tip).addScaledVector(d, -headLen / 2);
    this.group.add(head);
  }

  arc(a: SceneArc) {
    const axis = vec(a.axis).normalize();
    const start = vec(a.start).normalize();
    const center = vec(a.center);
    const headLen = a.tube * 6;
    // Buen stopper der pilspissen begynner.
    const sweep = a.sweep - Math.sign(a.sweep) * (headLen / a.radius);
    const at = (angle: number) => start.clone().applyAxisAngle(axis, angle).multiplyScalar(a.radius).add(center);
    const points = Array.from({ length: 49 }, (_, k) => at((sweep * k) / 48));
    const curve = new THREE.CatmullRomCurve3(points);
    const mat = this.solid(this.colors[a.tone]);
    this.group.add(new THREE.Mesh(this.track(new THREE.TubeGeometry(curve, 64, a.tube, 10, false)), mat));
    const end = points[points.length - 1]!;
    const tangent = start.clone().applyAxisAngle(axis, sweep).cross(axis).multiplyScalar(-Math.sign(a.sweep)).normalize();
    const head = new THREE.Mesh(this.cone, mat);
    head.scale.set(a.tube * 2.6, headLen, a.tube * 2.6);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    head.position.copy(end).addScaledVector(tangent, headLen / 2);
    this.group.add(head);
  }

  line(points: V3[], tone: Tone, dashed: boolean) {
    if (points.length < 2) return;
    const geometry = this.track(new LineGeometry());
    geometry.setPositions(points.flatMap((p) => p));
    const mat = new LineMaterial({ color: new THREE.Color(this.colors[tone]), linewidth: dashed ? 1.4 : 1.6, dashed, dashSize: 1, gapSize: 1, worldUnits: false });
    mat.resolution.set(this.size.width, this.size.height);
    this.lineMaterials.push(this.track(mat));
    const line = new Line2(geometry, mat);
    if (dashed) {
      const span = points.reduce((s, p, k) => (k ? s + vec(p).distanceTo(vec(points[k - 1]!)) : 0), 0);
      mat.dashSize = span / 14;
      mat.gapSize = span / 20;
      line.computeLineDistances();
    }
    this.group.add(line);
  }

  support(s: SceneSupport) {
    const down = vec(s.down).normalize();
    const u = new THREE.Vector3(down.y, -down.x, 0);
    const z = new THREE.Vector3(0, 0, 1);
    const mat = this.solid(this.colors.support, 0.28);
    const add = (geometry: THREE.BufferGeometry, local: THREE.Matrix4) => {
      const mesh = new THREE.Mesh(this.track(geometry), mat);
      mesh.applyMatrix4(local.premultiply(basis(u, down, z, vec(s.at))));
      this.group.add(mesh);
    };
    const h = s.size;
    const plate = (v: number) => add(new THREE.BoxGeometry(1.6 * h, 0.16 * h, s.depth * 1.1), new THREE.Matrix4().makeTranslation(0, v + 0.08 * h, 0));
    if (s.type === "fixed") {
      add(new THREE.BoxGeometry(1.8 * h, 0.3 * h, s.depth * 1.2), new THREE.Matrix4().makeTranslation(0, 0.15 * h, 0));
      return;
    }
    const tri = (height: number) => {
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-0.6 * h, height), new THREE.Vector2(0.6 * h, height)]);
      add(new THREE.ExtrudeGeometry(shape, { depth: s.depth, bevelEnabled: false }), new THREE.Matrix4().makeTranslation(0, 0, -s.depth / 2));
    };
    if (s.type === "pinned") {
      tri(h);
      plate(h);
      return;
    }
    tri(0.72 * h);
    for (const x of [-0.3 * h, 0.3 * h]) {
      const wheel = new THREE.CylinderGeometry(0.13 * h, 0.13 * h, s.depth, 16);
      wheel.rotateX(Math.PI / 2);
      add(wheel, new THREE.Matrix4().makeTranslation(x, 0.72 * h + 0.13 * h, 0));
    }
    plate(h);
  }

  hinge(at: V3, radius: number, depth: number) {
    const geometry = this.track(new THREE.CylinderGeometry(radius, radius, depth, 24));
    geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, this.solid("#ffffff"));
    mesh.position.copy(vec(at));
    this.group.add(mesh);
    this.edges(geometry, this.colors.load, 0.8, new THREE.Matrix4().makeTranslation(at[0], at[1], at[2]));
  }

  label(l: SceneLabel) {
    const el = document.createElement("div");
    el.className = `c3-label c3-${l.kind ?? "force"} c3-tone-${l.tone}${l.masked ? " is-masked" : ""}`;
    if (l.symbol) {
      const sym = document.createElement("span");
      sym.className = "c3-sym";
      sym.textContent = l.symbol;
      if (l.sub) {
        const sub = document.createElement("sub");
        sub.textContent = l.sub;
        sym.append(sub);
      }
      el.append(sym);
    }
    if (l.value !== undefined) {
      const value = document.createElement("span");
      value.className = "c3-value";
      value.textContent = l.symbol ? ` = ${l.value}` : l.value;
      el.append(value);
    }
    const obj = new CSS2DObject(el);
    obj.position.copy(vec(l.at));
    this.labels.add(obj);
  }

  setSize(width: number, height: number) {
    this.size = { width, height };
    for (const m of this.lineMaterials) m.resolution.set(width, height);
  }

  dispose() {
    this.labels.remove(...this.labels.children);
    for (const d of this.disposables) d.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.cylinder.dispose();
    this.cone.dispose();
  }
}

function build(scene: Scene3D, colors: ReturnType<typeof readColors>, size: { width: number; height: number }): Builder {
  const b = new Builder(colors, size);
  for (const body of scene.bodies) b.body(body);
  for (const f of scene.faces) b.face(f.center, f.normal, f.up, f.section, scene.span);
  for (const h of scene.hinges) b.hinge(h.at, h.radius, h.depth);
  for (const s of scene.supports) b.support(s);
  for (const a of scene.arrows) b.arrow(a);
  for (const a of scene.arcs) b.arc(a);
  for (const l of scene.lines) b.line(l.points, l.tone, l.dashed ?? false);
  for (const l of scene.labels) b.label(l);
  return b;
}

/**
 * Midtpunkt og avstand som får med alle punktene når kameraet ser fra retningen `view` (fra midten mot
 * kameraet). Regnet i kameraets akser, så en lang, flat bjelke fyller bredden.
 */
function frame(points: V3[], view: THREE.Vector3, aspect: number): { center: THREE.Vector3; distance: number } {
  const back = view.clone().normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(back).normalize();
  const up = back.clone().cross(right).normalize();
  const ps = points.map(vec);
  const xs = ps.map((p) => p.dot(right));
  const ys = ps.map((p) => p.dot(up));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const mid = ps.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(Math.max(ps.length, 1));
  const cz = mid.dot(back);
  const center = right.clone().multiplyScalar(cx).addScaledVector(up, cy).addScaledVector(back, cz);
  const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
  const tanH = tanV * aspect;
  let distance = 1e-6;
  for (const p of ps) {
    const d = p.clone().sub(center);
    const z = d.dot(back);
    distance = Math.max(distance, z + Math.abs(d.dot(right)) / tanH, z + Math.abs(d.dot(up)) / tanV);
  }
  return { center, distance: distance * 1.1 };
}

interface Engine {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  colors: ReturnType<typeof readColors>;
  content?: Builder;
  render(): void;
}

export default function Cut3DCanvas({ scene, viewKey, label }: { scene: Scene3D; viewKey: string; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const framed = useRef<{ key: string; focus: V3 } | null>(null);
  const [failed, setFailed] = useState(false);

  // Oppsett én gang: renderer, kamera, lys og styring.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xffffff, 0);
    host.append(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = "c3-labels";
    host.append(labels.domElement);

    const three = new THREE.Scene();
    three.add(new THREE.HemisphereLight(0xffffff, 0xe7dfd2, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(0.6, 1.4, 1.2);
    three.add(sun);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
    // Vanlig rulling skal rulle siden, ikke zoome: bare Ctrl/⌘ + rull (og knip på styreflate, som gir ctrlKey) zoomer.
    const wheelGuard = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) e.stopImmediatePropagation();
    };
    renderer.domElement.addEventListener("wheel", wheelGuard, { capture: true });
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.zoomToCursor = true;

    const engine: Engine = {
      renderer,
      labels,
      scene: three,
      camera,
      controls,
      colors: readColors(),
      render: () => {
        renderer.render(three, camera);
        labels.render(three, camera);
      },
    };
    engineRef.current = engine;
    controls.addEventListener("change", engine.render);

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      labels.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      engine.content?.setSize(width, height);
      engine.render();
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
    ro?.observe(host);
    resize();

    return () => {
      ro?.disconnect();
      renderer.domElement.removeEventListener("wheel", wheelGuard, { capture: true });
      controls.removeEventListener("change", engine.render);
      controls.dispose();
      engine.content?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
      engineRef.current = null;
      framed.current = null;
    };
  }, []);

  // Ny scene: bygg objektene på nytt, og sett kameraet når visningen er ny.
  useEffect(() => {
    const engine = engineRef.current;
    const host = hostRef.current;
    if (!engine || !host) return;
    const size = { width: host.clientWidth || 1, height: host.clientHeight || 1 };
    const previous = engine.content;
    if (previous) {
      engine.scene.remove(previous.group, previous.labels);
      previous.dispose();
    }
    const content = build(scene, engine.colors, size);
    engine.content = content;
    engine.scene.add(content.group, content.labels);

    const { camera, controls } = engine;
    const target = scene.mode === "stress" ? scene.focus : scene.bounds;
    if (framed.current?.key !== viewKey) {
      const fit = frame(scene.framePoints.length ? scene.framePoints : [target.center], vec(scene.view), camera.aspect);
      const center = fit.center;
      const distance = fit.distance * (scene.mode === "stress" ? 1.25 : 1);
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(vec(scene.view), distance);
      camera.near = distance / 100;
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      controls.minDistance = 0.04 * scene.span;
      controls.maxDistance = 8 * scene.span + distance;
      framed.current = { key: viewKey, focus: scene.focus.center };
    } else if (scene.mode === "stress") {
      // Spenningsvisningen følger snittet når det dras.
      const shift = vec(scene.focus.center).sub(vec(framed.current.focus));
      camera.position.add(shift);
      controls.target.add(shift);
      framed.current = { key: viewKey, focus: scene.focus.center };
    }
    controls.update();
    engine.render();
  }, [scene, viewKey]);

  if (failed) return <p className="c3-fallback muted">3D-visningen trenger WebGL, som ikke er tilgjengelig i denne nettleseren. Tallene for snittet står under.</p>;
  return <div ref={hostRef} className="c3-canvas" role="img" aria-label={label} />;
}
