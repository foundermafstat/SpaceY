import type { CSSProperties, ImgHTMLAttributes } from "react";

const sliceMeta = {
  "mini-tabs": [120, 84],
  "button-active-left": [214, 54],
  "button-active-right": [236, 54],
  "button-dark-left": [214, 48],
  "button-dark-right": [236, 48],
  "controls-strip": [390, 83],
  "input-stack": [238, 106],
  "panel-large": [660, 420],
  "panel-side": [215, 398],
  "panel-medium": [492, 242],
  "panel-tall": [334, 320],
  "card-locked-left": [145, 250],
  "card-locked-right": [145, 250],
  "panel-card-stack": [368, 206],
  "icons-row": [660, 96],
  "victory-banner": [400, 178],
  "defeat-banner": [382, 118],
  "progress-long": [780, 76],
  "double-bars": [576, 78],
  "small-panels": [438, 220],
  ruler: [600, 76],
  "hud-top": [672, 156],
  "hud-bottom": [600, 110]
} as const;

export type ReferenceSliceName = keyof typeof sliceMeta;

export function ReferenceSlice({
  name,
  className,
  style,
  variant = "svg",
  ...props
}: {
  name: ReferenceSliceName;
  className?: string;
  style?: CSSProperties;
  variant?: "svg" | "transparent" | "raw";
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "height" | "src" | "width">) {
  const [width, height] = sliceMeta[name];
  const basePath =
    variant === "svg"
      ? "/assets/ui/reference-kit/svg"
      : variant === "transparent"
        ? "/assets/ui/reference-kit/transparent"
        : "/assets/ui/reference-kit";
  const extension = variant === "svg" ? "svg" : "png";

  return (
    <img
      alt=""
      className={className}
      draggable={false}
      height={height}
      src={`${basePath}/${name}.${extension}`}
      style={style}
      width={width}
      {...props}
    />
  );
}
