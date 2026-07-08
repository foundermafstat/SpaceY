import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import { ReferenceSlice, type ReferenceSliceName } from "./ReferenceSlices";

const sizes = {
  "button-active-left": [214, 54],
  "button-active-right": [236, 54],
  "button-dark-left": [214, 48],
  "button-dark-right": [236, 48],
  "input-stack": [238, 106],
  "panel-large": [660, 420],
  "panel-side": [215, 398],
  "panel-medium": [492, 242],
  "panel-tall": [334, 320],
  "card-locked-left": [145, 250],
  "card-locked-right": [145, 250],
  "victory-banner": [400, 178],
  "defeat-banner": [382, 118]
} as const;

type SizedSlice = keyof typeof sizes;

function assetUrl(name: ReferenceSliceName | SizedSlice) {
  return `/assets/ui/reference-kit/svg/${name}.svg`;
}

function slicedStyle(name: SizedSlice, style?: CSSProperties): CSSProperties {
  const [width, height] = sizes[name];

  return {
    width,
    height,
    backgroundImage: `url("${assetUrl(name)}")`,
    ...style
  };
}

export function SlicedButton({
  children,
  variant = "active",
  side = "left",
  className,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "active" | "dark";
  side?: "left" | "right";
}) {
  const name = `button-${variant}-${side}` as SizedSlice;

  return (
    <button
      className={`sliced-button ${variant === "active" ? "is-active" : "is-dark"} ${className ?? ""}`}
      style={slicedStyle(name, style)}
      {...props}
    >
      <span>{children}</span>
    </button>
  );
}

export function SlicedPanel({
  children,
  variant = "large",
  title,
  className,
  style
}: {
  children?: ReactNode;
  variant?: "large" | "medium" | "tall" | "side";
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const name = `panel-${variant}` as SizedSlice;

  return (
    <section className={`sliced-panel sliced-panel-${variant} ${className ?? ""}`} style={slicedStyle(name, style)}>
      {title && <header>{title}</header>}
      <div className="sliced-panel-content">{children}</div>
    </section>
  );
}

export function SlicedInputStack({
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
    <div className={`sliced-input-stack ${className ?? ""}`} style={slicedStyle("input-stack", style)}>
      <input aria-label="Email" {...emailProps} />
      <input aria-label="Password" type="password" {...passwordProps} />
    </div>
  );
}

export function SlicedCard({
  side = "left",
  children,
  className,
  style
}: {
  side?: "left" | "right";
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const name = `card-locked-${side}` as SizedSlice;

  return (
    <article className={`sliced-card ${className ?? ""}`} style={slicedStyle(name, style)}>
      {children}
    </article>
  );
}

export function SlicedBanner({
  variant = "victory",
  label,
  className,
  style
}: {
  variant?: "victory" | "defeat";
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const name = `${variant}-banner` as SizedSlice;

  return (
    <div className={`sliced-banner sliced-banner-${variant} ${className ?? ""}`} style={slicedStyle(name, style)}>
      {label && <span>{label}</span>}
    </div>
  );
}

export function SlicedStatic({
  name,
  className,
  style
}: {
  name: ReferenceSliceName;
  className?: string;
  style?: CSSProperties;
}) {
  return <ReferenceSlice className={`sliced-static ${className ?? ""}`} name={name} style={style} />;
}
