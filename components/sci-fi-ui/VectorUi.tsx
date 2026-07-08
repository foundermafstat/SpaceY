import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";

type ChromeTone = "active" | "dark" | "danger";

function buttonPath(width: number, height: number) {
  const notchY = Math.max(4, Math.round(height * 0.12));
  const cut = Math.round(height * 0.26);

  return [
    `M ${cut} 0`,
    `H ${Math.round(width * 0.44)}`,
    `L ${Math.round(width * 0.47)} ${notchY}`,
    `H ${Math.round(width * 0.64)}`,
    `L ${Math.round(width * 0.67)} 0`,
    `H ${width}`,
    `V ${Math.round(height * 0.68)}`,
    `L ${width - cut} ${height}`,
    `H ${Math.round(width * 0.58)}`,
    `L ${Math.round(width * 0.55)} ${height - notchY}`,
    `H ${Math.round(width * 0.42)}`,
    `L ${Math.round(width * 0.39)} ${height}`,
    `H ${cut}`,
    `L 0 ${Math.round(height * 0.72)}`,
    `V ${Math.round(height * 0.28)}`,
    "Z"
  ].join(" ");
}

function panelPath(width: number, height: number) {
  const cut = Math.round(Math.min(width, height) * 0.035);

  return `M ${cut} 0 H ${width - cut} L ${width} ${cut} V ${height - cut} L ${width - cut} ${height} H ${cut} L 0 ${height - cut} V ${cut} Z`;
}

function BannerMark() {
  return (
    <svg className="vector-banner-mark" viewBox="0 0 240 150" aria-hidden="true">
      <path d="M0 0h48l72 72L192 0h48l-56 66h-35v84h-58V66H56z" />
      <path d="M78 0h28l-18 46L36 22z" />
      <path d="M134 0h28l52 22-52 24z" />
    </svg>
  );
}

function VectorChrome({
  width,
  height,
  tone,
  children
}: {
  width: number;
  height: number;
  tone: ChromeTone;
  children?: ReactNode;
}) {
  return (
    <svg className={`vector-chrome vector-${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="vector-fill" d={buttonPath(width, height)} />
      <path className="vector-line" d={buttonPath(width, height)} />
      <path className="vector-top-line" d={`M ${Math.round(width * 0.51)} 3 H ${Math.round(width * 0.62)}`} />
      {children}
    </svg>
  );
}

export function VectorButton({
  children,
  tone = "active",
  width = 214,
  height = 54,
  className,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ChromeTone;
  width?: number;
  height?: number;
}) {
  return (
    <button
      className={`vector-button vector-${tone} ${className ?? ""}`}
      style={{ width, height, ...style } as CSSProperties}
      {...props}
    >
      <VectorChrome height={height} tone={tone} width={width} />
      <span>{children}</span>
    </button>
  );
}

export function VectorPanel({
  children,
  title,
  width = 660,
  height = 420,
  className,
  style
}: {
  children?: ReactNode;
  title?: string;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`vector-panel ${className ?? ""}`} style={{ width, height, ...style } as CSSProperties}>
      <svg className="vector-panel-chrome" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="vector-panel-fill" d={panelPath(width, height)} />
        <path className="vector-panel-line" d={panelPath(width, height)} />
        <path className="vector-panel-tab" d={`M ${width * 0.39} 0 H ${width * 0.61} L ${width * 0.56} 50 H ${width * 0.44} Z`} />
        <path className="vector-panel-chip" d={`M ${width * 0.47} 3 H ${width * 0.53}`} />
      </svg>
      {title && <header>{title}</header>}
      <div className="vector-panel-content">{children}</div>
    </section>
  );
}

export function VectorInputStack({
  emailProps,
  passwordProps,
  className,
  style
}: {
  emailProps?: InputHTMLAttributes<HTMLInputElement>;
  passwordProps?: InputHTMLAttributes<HTMLInputElement>;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`vector-input-stack ${className ?? ""}`} style={style}>
      <VectorInput aria-label="Email" {...emailProps} />
      <VectorInput aria-label="Password" type="password" {...passwordProps} />
    </div>
  );
}

export function VectorInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`vector-input ${className ?? ""}`}>
      <svg viewBox="0 0 238 42" preserveAspectRatio="none" aria-hidden="true">
        <path className="vector-input-fill" d={buttonPath(238, 42)} />
        <path className="vector-input-line" d={buttonPath(238, 42)} />
      </svg>
      <input {...props} />
    </label>
  );
}

export function VectorCard({
  children,
  width = 145,
  height = 250,
  className,
  style
}: {
  children?: ReactNode;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <article className={`vector-card ${className ?? ""}`} style={{ width, height, ...style } as CSSProperties}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="vector-panel-fill" d={panelPath(width, height)} />
        <path className="vector-panel-line" d={panelPath(width, height)} />
        <path className="vector-panel-chip" d={`M ${width * 0.38} 2 H ${width * 0.62}`} />
        <path className="vector-panel-chip bottom" d={`M ${width * 0.38} ${height - 2} H ${width * 0.62}`} />
      </svg>
      <div>{children}</div>
    </article>
  );
}

export function VectorBanner({
  label = "VICTORY",
  tone = "active",
  className,
  style
}: {
  label?: string;
  tone?: "active" | "danger";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`vector-banner vector-${tone} ${className ?? ""}`} style={style}>
      {tone === "active" && <BannerMark />}
      <svg className="vector-banner-plate" viewBox="0 0 400 86" preserveAspectRatio="none" aria-hidden="true">
        <path d="M34 0h332l34 43-34 43H34L0 43z" />
        <path d="M58 10h284" />
        <path d="M58 76h284" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function VectorSegmentedBar({
  value = 70,
  segments = 10,
  className,
  style
}: {
  value?: number;
  segments?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const active = Math.round((segments * value) / 100);

  return (
    <div className={`vector-segmented-bar ${className ?? ""}`} style={style}>
      {Array.from({ length: segments }).map((_, index) => (
        <i className={index < active ? "active" : ""} key={index} />
      ))}
    </div>
  );
}
