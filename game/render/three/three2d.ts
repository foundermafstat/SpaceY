import * as THREE from "three";

export type TextStyleFontWeight = "normal" | "bold" | "bolder" | "lighter" | number | string;

type TextureImage = HTMLImageElement | HTMLCanvasElement;
type TextureSource = {
  image: TextureImage;
  width: number;
  height: number;
  src?: string;
  baseMap?: THREE.Texture;
};
type FillStyle = { color: number; alpha?: number };
type StrokeStyle = FillStyle & { width?: number };
type PointerHandler = (event: { global: { x: number; y: number }; originalEvent: PointerEvent }) => void;

export class Rectangle {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number
  ) {}
}

export class Texture {
  source: TextureSource;
  frame: Rectangle;
  private map?: THREE.Texture;

  constructor(input: { source: TextureSource; frame?: Rectangle }) {
    this.source = input.source;
    this.frame = input.frame ?? new Rectangle(0, 0, input.source.width, input.source.height);
  }

  static fromCanvas(canvas: HTMLCanvasElement) {
    return new Texture({
      source: {
        image: canvas,
        width: canvas.width,
        height: canvas.height
      }
    });
  }

  get width() {
    return this.frame.width;
  }

  get height() {
    return this.frame.height;
  }

  toThreeTexture(repeat = false) {
    if (!this.map || repeat) {
      const base = this.source.baseMap ?? createBaseTexture(this.source.image);
      this.source.baseMap = base;
      const map = base.clone();
      map.needsUpdate = true;
      map.colorSpace = THREE.SRGBColorSpace;
      map.minFilter = THREE.LinearFilter;
      map.magFilter = THREE.LinearFilter;
      map.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      map.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      map.repeat.set(this.frame.width / this.source.width, this.frame.height / this.source.height);
      map.offset.set(this.frame.x / this.source.width, 1 - (this.frame.y + this.frame.height) / this.source.height);
      if (repeat) return map;
      this.map = map;
    }
    return this.map;
  }
}

export const Assets = {
  async load<T = Texture>(src: string): Promise<T> {
    const cached = textureCache.get(src);
    if (cached) return cached as T;

    const image = await loadImage(src);
    const texture = new Texture({
      source: {
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        src
      }
    });
    textureCache.set(src, texture);
    return texture as T;
  }
};

class ObservablePoint {
  constructor(
    public x: number,
    public y: number,
    private readonly onChange: () => void
  ) {}

  set(x = 0, y = x) {
    this.x = x;
    this.y = y;
    this.onChange();
  }

  copyFrom(point: { x: number; y: number }) {
    this.x = point.x;
    this.y = point.y;
    this.onChange();
  }
}

class Ticker {
  deltaMS = 16.67;
  private callbacks = new Set<() => void>();
  private frame = 0;
  private lastTime = performance.now();

  add(callback: () => void) {
    this.callbacks.add(callback);
  }

  remove(callback: () => void) {
    this.callbacks.delete(callback);
  }

  start(render: () => void) {
    const tick = (now: number) => {
      this.deltaMS = Math.max(0.001, now - this.lastTime);
      this.lastTime = now;
      this.callbacks.forEach((callback) => callback());
      render();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.callbacks.clear();
  }
}

export class DisplayObject {
  readonly object3d: THREE.Group;
  readonly position: ObservablePoint;
  readonly scale: ObservablePoint;
  readonly pivot: ObservablePoint;
  parent: Container | null = null;
  eventMode?: string;
  hitArea?: unknown;
  zIndex = 0;
  sortableChildren = false;
  protected _alpha = 1;
  protected _visible = true;
  private _rotation = 0;
  private handlers = new Map<string, PointerHandler[]>();

  constructor() {
    this.object3d = new THREE.Group();
    this.object3d.userData.displayObject = this;
    this.position = new ObservablePoint(0, 0, () => this.syncTransform());
    this.scale = new ObservablePoint(1, 1, () => this.syncTransform());
    this.pivot = new ObservablePoint(0, 0, () => this.syncTransform());
    this.syncTransform();
  }

  get x() {
    return this.position.x;
  }

  set x(value: number) {
    this.position.set(value, this.position.y);
  }

  get y() {
    return this.position.y;
  }

  set y(value: number) {
    this.position.set(this.position.x, value);
  }

  get rotation() {
    return this._rotation;
  }

  set rotation(value: number) {
    this._rotation = value;
    this.syncTransform();
  }

  get angle() {
    return (this._rotation * 180) / Math.PI;
  }

  set angle(value: number) {
    this.rotation = (value * Math.PI) / 180;
  }

  get alpha() {
    return this._alpha;
  }

  set alpha(value: number) {
    this._alpha = value;
  }

  get visible() {
    return this._visible;
  }

  set visible(value: boolean) {
    this._visible = value;
    this.object3d.visible = value;
  }

  on(type: string, handler: PointerHandler) {
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
    return this;
  }

  emitPointer(type: string, event: { global: { x: number; y: number }; originalEvent: PointerEvent }) {
    this.handlers.get(type)?.forEach((handler) => handler(event));
  }

  destroy() {
    this.parent?.removeChild(this);
    this.object3d.removeFromParent();
    this.handlers.clear();
  }

  syncRenderState(parentAlpha: number, parentVisible: boolean, order: { value: number }) {
    this.object3d.visible = parentVisible && this.visible;
    this.applySelfRenderState(parentAlpha * this.alpha, order);
  }

  protected applySelfRenderState(_alpha: number, _order: { value: number }) {}

  protected syncTransform() {
    this.object3d.position.set(this.position.x - this.pivot.x, -this.position.y + this.pivot.y, 0);
    this.object3d.rotation.z = -this._rotation;
    this.object3d.scale.set(this.scale.x, this.scale.y, 1);
  }
}

export class Container extends DisplayObject {
  readonly children: DisplayObject[] = [];

  addChild<T extends DisplayObject[]>(...children: T) {
    children.forEach((child) => {
      child.parent?.removeChild(child);
      child.parent = this;
      this.children.push(child);
      this.object3d.add(child.object3d);
    });
    return children[0];
  }

  removeChild(child: DisplayObject) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
    this.object3d.remove(child.object3d);
    return child;
  }

  removeChildAt(index: number) {
    const child = this.children[index];
    if (!child) throw new Error(`No child at index ${index}`);
    return this.removeChild(child);
  }

  override destroy() {
    [...this.children].forEach((child) => child.destroy());
    super.destroy();
  }

  override syncRenderState(parentAlpha: number, parentVisible: boolean, order: { value: number }) {
    super.syncRenderState(parentAlpha, parentVisible, order);
    const alpha = parentAlpha * this.alpha;
    const visible = parentVisible && this.visible;
    const children = this.sortableChildren ? [...this.children].sort((a, b) => a.zIndex - b.zIndex) : this.children;
    children.forEach((child) => child.syncRenderState(alpha, visible, order));
  }
}

export class Sprite extends Container {
  readonly anchor: ObservablePoint;
  protected mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private _texture: Texture;
  private _tint = 0xffffff;
  private baseWidth: number;
  private baseHeight: number;
  private explicitSize = false;

  constructor(texture: Texture) {
    super();
    this._texture = texture;
    this.baseWidth = texture.width;
    this.baseHeight = texture.height;
    this.anchor = new ObservablePoint(0, 0, () => this.syncPlane());
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: texture.toThreeTexture(),
        color: this._tint,
        transparent: true,
        depthTest: false,
        depthWrite: false
      })
    );
    this.object3d.add(this.mesh);
    this.syncPlane();
  }

  get texture() {
    return this._texture;
  }

  set texture(texture: Texture) {
    this._texture = texture;
    if (!this.explicitSize) {
      this.baseWidth = texture.width;
      this.baseHeight = texture.height;
    }
    this.mesh.material.map = texture.toThreeTexture();
    this.mesh.material.needsUpdate = true;
    this.syncPlane();
  }

  get tint() {
    return this._tint;
  }

  set tint(value: number) {
    this._tint = value;
    this.mesh.material.color.setHex(value);
  }

  get width() {
    return this.baseWidth * this.scale.x;
  }

  set width(value: number) {
    this.explicitSize = true;
    this.baseWidth = value;
    this.syncPlane();
  }

  get height() {
    return this.baseHeight * this.scale.y;
  }

  set height(value: number) {
    this.explicitSize = true;
    this.baseHeight = value;
    this.syncPlane();
  }

  override destroy() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    super.destroy();
  }

  protected override applySelfRenderState(alpha: number, order: { value: number }) {
    this.mesh.renderOrder = order.value;
    this.mesh.material.opacity = alpha;
    this.mesh.visible = this.visible;
    order.value += 1;
  }

  protected syncPlane() {
    this.mesh.scale.set(this.baseWidth, this.baseHeight, 1);
    this.mesh.position.set((0.5 - this.anchor.x) * this.baseWidth, -(0.5 - this.anchor.y) * this.baseHeight, 0);
  }
}

export class TilingSprite extends Sprite {
  readonly tileScale: ObservablePoint;
  readonly tilePosition: ObservablePoint;
  private tileMap: THREE.Texture;

  constructor(input: { texture: Texture; width: number; height: number }) {
    super(input.texture);
    this.tileScale = new ObservablePoint(1, 1, () => this.syncTile());
    this.tilePosition = new ObservablePoint(0, 0, () => this.syncTile());
    this.tileMap = input.texture.toThreeTexture(true);
    this.mesh.material.map = this.tileMap;
    this.mesh.material.needsUpdate = true;
    this.width = input.width;
    this.height = input.height;
    this.syncTile();
  }

  override get width() {
    return super.width;
  }

  override set width(value: number) {
    super.width = value;
    this.syncTile();
  }

  override get height() {
    return super.height;
  }

  override set height(value: number) {
    super.height = value;
    this.syncTile();
  }

  private syncTile() {
    if (!this.tileMap) return;
    const tileWidth = Math.max(1, this.texture.width * this.tileScale.x);
    const tileHeight = Math.max(1, this.texture.height * this.tileScale.y);
    this.tileMap.repeat.set(this.width / tileWidth, this.height / tileHeight);
    this.tileMap.offset.set(-this.tilePosition.x / tileWidth, this.tilePosition.y / tileHeight);
  }
}

export class Graphics extends Container {
  private drawObjects: THREE.Object3D[] = [];
  private path: { x: number; y: number }[] = [];
  private pathClosed = false;
  private pendingShape: PendingShape | null = null;

  clear() {
    this.drawObjects.forEach((object) => {
      object.removeFromParent();
      disposeObject(object);
    });
    this.drawObjects = [];
    this.path = [];
    this.pathClosed = false;
    this.pendingShape = null;
    return this;
  }

  moveTo(x: number, y: number) {
    this.path = [{ x, y }];
    this.pathClosed = false;
    this.pendingShape = null;
    return this;
  }

  lineTo(x: number, y: number) {
    this.path.push({ x, y });
    this.pendingShape = null;
    return this;
  }

  closePath() {
    this.pathClosed = true;
    return this;
  }

  poly(points: number[]) {
    this.path = [];
    for (let i = 0; i < points.length; i += 2) {
      this.path.push({ x: points[i], y: points[i + 1] });
    }
    this.pathClosed = true;
    this.pendingShape = null;
    return this;
  }

  circle(x: number, y: number, radius: number) {
    this.pendingShape = { kind: "ellipse", x, y, radiusX: radius, radiusY: radius };
    return this;
  }

  ellipse(x: number, y: number, radiusX: number, radiusY: number) {
    this.pendingShape = { kind: "ellipse", x, y, radiusX, radiusY };
    return this;
  }

  rect(x: number, y: number, width: number, height: number) {
    this.pendingShape = { kind: "rect", x, y, width, height };
    return this;
  }

  roundRect(x: number, y: number, width: number, height: number, _radius: number) {
    return this.rect(x, y, width, height);
  }

  fill(style: FillStyle) {
    const alpha = style.alpha ?? 1;
    const mesh = this.pendingShape
      ? makeFilledShape(this.pendingShape, style.color, alpha)
      : makeFilledPath(this.path, style.color, alpha);
    if (mesh) this.addDrawObject(mesh);
    return this;
  }

  stroke(style: StrokeStyle) {
    const alpha = style.alpha ?? 1;
    const width = style.width ?? 1;
    const objects = this.pendingShape
      ? makeShapeStroke(this.pendingShape, style.color, alpha, width)
      : makePathStroke(this.path, this.pathClosed, style.color, alpha, width);
    objects.forEach((object) => this.addDrawObject(object));
    return this;
  }

  override destroy() {
    this.clear();
    super.destroy();
  }

  protected override applySelfRenderState(alpha: number, order: { value: number }) {
    this.drawObjects.forEach((object) => {
      object.renderOrder = order.value;
      object.traverse((child: THREE.Object3D) => {
        const material = getObjectMaterial(child);
        if (!material) return;
        material.opacity = (material.userData.baseAlpha ?? 1) * alpha;
      });
      order.value += 1;
    });
  }

  private addDrawObject(object: THREE.Object3D) {
    this.drawObjects.push(object);
    this.object3d.add(object);
  }
}

export class Text extends Sprite {
  private style: {
    fill?: number;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: TextStyleFontWeight;
    letterSpacing?: number;
  };
  private _text: string;

  constructor(input: {
    text: string;
    style?: {
      fill?: number;
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: TextStyleFontWeight;
      letterSpacing?: number;
    };
  }) {
    super(makeTextTexture(input.text, input.style));
    this._text = input.text;
    this.style = input.style ?? {};
  }

  get text() {
    return this._text;
  }

  set text(value: string) {
    this._text = value;
    const texture = makeTextTexture(value, this.style);
    this.texture = texture;
    this.width = texture.width;
    this.height = texture.height;
  }
}

export class Application {
  readonly stage = new Container();
  readonly ticker = new Ticker();
  readonly screen = new Rectangle(0, 0, 1, 1);
  renderer!: { resize: (width: number, height: number) => void };
  canvas!: HTMLCanvasElement;
  private webgl!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private removePointerListeners: Array<() => void> = [];

  async init(options: {
    width: number;
    height: number;
    background?: string | number;
    backgroundAlpha?: number;
    antialias?: boolean;
    resolution?: number;
  }) {
    this.scene = new THREE.Scene();
    this.scene.add(this.stage.object3d);
    this.camera = new THREE.OrthographicCamera(0, options.width, 0, -options.height, -10000, 10000);
    this.camera.position.z = 1000;

    this.webgl = new THREE.WebGLRenderer({
      antialias: options.antialias ?? true,
      alpha: (options.backgroundAlpha ?? 1) < 1
    });
    this.webgl.sortObjects = false;
    this.webgl.setPixelRatio(options.resolution ?? window.devicePixelRatio);
    this.webgl.setClearColor(new THREE.Color(options.background ?? "#000000"), options.backgroundAlpha ?? 1);
    this.webgl.setSize(options.width, options.height, false);
    this.canvas = this.webgl.domElement;
    this.screen.width = options.width;
    this.screen.height = options.height;
    this.renderer = {
      resize: (width: number, height: number) => this.resize(width, height)
    };
    this.bindPointerEvents();
    this.ticker.start(() => this.render());
  }

  destroy() {
    this.ticker.stop();
    this.removePointerListeners.forEach((remove) => remove());
    this.stage.destroy();
    this.webgl.dispose();
    this.canvas?.remove();
  }

  private resize(width: number, height: number) {
    this.screen.width = width;
    this.screen.height = height;
    this.camera.right = width;
    this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(width, height, false);
  }

  private render() {
    this.stage.syncRenderState(1, true, { value: 0 });
    this.webgl.render(this.scene, this.camera);
  }

  private bindPointerEvents() {
    const bind = (type: string, targetType = type) => {
      const listener: EventListener = (event) => {
        const pointerEvent = event as PointerEvent;
        const rect = this.canvas.getBoundingClientRect();
        this.stage.emitPointer(targetType, {
          global: {
            x: pointerEvent.clientX - rect.left,
            y: pointerEvent.clientY - rect.top
          },
          originalEvent: pointerEvent
        });
      };
      this.canvas.addEventListener(type, listener);
      this.removePointerListeners.push(() => this.canvas.removeEventListener(type, listener));
    };

    bind("pointerdown");
    bind("pointermove");
    bind("pointerup");
    bind("pointercancel", "pointerupoutside");
    bind("pointerleave", "pointerupoutside");
  }
}

type PendingShape =
  | { kind: "ellipse"; x: number; y: number; radiusX: number; radiusY: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number };

const textureCache = new Map<string, Texture>();

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });
}

function createBaseTexture(image: TextureImage) {
  const map = image instanceof HTMLCanvasElement ? new THREE.CanvasTexture(image) : new THREE.Texture(image);
  map.needsUpdate = true;
  map.colorSpace = THREE.SRGBColorSpace;
  map.minFilter = THREE.LinearFilter;
  map.magFilter = THREE.LinearFilter;
  return map;
}

function makeMaterial(color: number, alpha: number) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: alpha,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  material.userData.baseAlpha = alpha;
  return material;
}

function makeFilledShape(shape: PendingShape, color: number, alpha: number) {
  if (shape.kind === "rect") {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(shape.width, shape.height), makeMaterial(color, alpha));
    mesh.position.set(shape.x + shape.width / 2, -(shape.y + shape.height / 2), 0);
    return mesh;
  }

  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 32), makeMaterial(color, alpha));
  mesh.position.set(shape.x, -shape.y, 0);
  mesh.scale.set(shape.radiusX, shape.radiusY, 1);
  return mesh;
}

function makeFilledPath(points: { x: number; y: number }[], color: number, alpha: number) {
  if (points.length < 3) return null;
  const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, -point.y)));
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), makeMaterial(color, alpha));
  return mesh;
}

function makeShapeStroke(shape: PendingShape, color: number, alpha: number, width: number) {
  if (shape.kind === "rect") {
    const x = shape.x;
    const y = shape.y;
    const w = shape.width;
    const h = shape.height;
    return [
      makeSegment(x, y, x + w, y, width, color, alpha),
      makeSegment(x + w, y, x + w, y + h, width, color, alpha),
      makeSegment(x + w, y + h, x, y + h, width, color, alpha),
      makeSegment(x, y + h, x, y, width, color, alpha)
    ];
  }

  const outer = Math.max(shape.radiusX, shape.radiusY);
  const inner = Math.max(0.01, outer - width);
  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), makeMaterial(color, alpha));
  mesh.position.set(shape.x, -shape.y, 0);
  mesh.scale.set(shape.radiusX / outer, shape.radiusY / outer, 1);
  return [mesh];
}

function makePathStroke(points: { x: number; y: number }[], closed: boolean, color: number, alpha: number, width: number) {
  if (points.length < 2) return [];
  const segments: THREE.Object3D[] = [];
  for (let i = 1; i < points.length; i += 1) {
    segments.push(makeSegment(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, width, color, alpha));
  }
  if (closed && points.length > 2) {
    const last = points[points.length - 1];
    const first = points[0];
    segments.push(makeSegment(last.x, last.y, first.x, first.y, width, color, alpha));
  }
  return segments;
}

function makeSegment(x1: number, y1: number, x2: number, y2: number, width: number, color: number, alpha: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, width), makeMaterial(color, alpha));
  mesh.position.set((x1 + x2) / 2, -((y1 + y2) / 2), 0);
  mesh.rotation.z = -Math.atan2(dy, dx);
  return mesh;
}

function makeTextTexture(
  value: string,
  style: {
    fill?: number;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: TextStyleFontWeight;
    letterSpacing?: number;
  } = {}
) {
  const fontSize = style.fontSize ?? 12;
  const fontWeight = style.fontWeight ?? "400";
  const fontFamily = style.fontFamily ?? "Arial, sans-serif";
  const text = value || " ";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.width = 1;
    canvas.height = 1;
    return Texture.fromCanvas(canvas);
  }

  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const metrics = context.measureText(text);
  canvas.width = Math.max(1, Math.ceil(metrics.width + 8));
  canvas.height = Math.max(1, Math.ceil(fontSize * 1.5));
  const nextContext = canvas.getContext("2d")!;
  nextContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  nextContext.textAlign = "center";
  nextContext.textBaseline = "middle";
  nextContext.fillStyle = `#${(style.fill ?? 0xffffff).toString(16).padStart(6, "0")}`;
  nextContext.fillText(text, canvas.width / 2, canvas.height / 2);
  return Texture.fromCanvas(canvas);
}

function getObjectMaterial(object: THREE.Object3D) {
  const maybeMesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
  const material = maybeMesh.material;
  if (!material) return null;
  return Array.isArray(material) ? (material[0] as THREE.MeshBasicMaterial) : (material as THREE.MeshBasicMaterial);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child: THREE.Object3D) => {
    const maybeMesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    maybeMesh.geometry?.dispose();
    const material = maybeMesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose();
    }
  });
}
