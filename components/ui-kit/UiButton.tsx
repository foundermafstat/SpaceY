import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type UiButtonVariant = "primary" | "secondary";
type UiButtonSize = "md" | "sm" | "icon";
type UiButtonSide = "left" | "right";

type UiButtonBaseProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  side?: UiButtonSide;
  size?: UiButtonSize;
  style?: CSSProperties;
  variant?: UiButtonVariant;
};

const assetSizes = {
  left: [214, 42],
  right: [236, 42]
} as const;

function UiButtonShape() {
  return (
    <svg
      aria-hidden="true"
      className="ui-button-shape"
      focusable="false"
      preserveAspectRatio="none"
      viewBox="0 0 214 36"
    >
      <path
        className="ui-button-shape-fill ui-button-shape-island"
        d="M103 5.75H120L123 8H106Z"
      />
      <path
        className="ui-button-shape-fill"
        d="M18 7H101L106 11H174L179 7H201V25L195 32H180L176 35H129L125 32H18L12 25V15Z"
      />
    </svg>
  );
}

function getUiButtonClassName({
  className,
  disabled,
  size = "md",
  variant = "secondary"
}: Omit<UiButtonBaseProps, "children">) {
  return [
    "ui-button",
    `ui-button--${variant}`,
    `ui-button--${size}`,
    disabled ? "ui-button--disabled" : "",
    className ?? ""
  ].filter(Boolean).join(" ");
}

function getUiButtonStyle({
  side = "left",
  size = "md",
  style,
  variant = "secondary"
}: Pick<UiButtonBaseProps, "side" | "size" | "style" | "variant">) {
  const [assetWidth, assetHeight] = assetSizes[side];
  const [width, height] = size === "icon"
    ? [32, 30]
    : size === "sm"
      ? [118, 32]
      : [assetWidth, assetHeight];

  return {
    "--ui-button-width": `${width}px`,
    "--ui-button-height": `${height}px`,
    ...style
  } as CSSProperties;
}

export function UiButton({
  children,
  className,
  disabled,
  side,
  size,
  style,
  type = "button",
  variant,
  ...props
}: UiButtonBaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={getUiButtonClassName({ className, disabled, size, variant })}
      disabled={disabled}
      style={getUiButtonStyle({ side, size, style, variant })}
      type={type}
      {...props}
    >
      <UiButtonShape />
      <span>{children}</span>
    </button>
  );
}

export function UiLinkButton({
  children,
  className,
  disabled,
  href,
  side,
  size,
  style,
  tabIndex,
  variant,
  ...props
}: UiButtonBaseProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: LinkProps<string>["href"] }) {
  return (
    <Link
      aria-disabled={disabled || undefined}
      className={getUiButtonClassName({ className, disabled, size, variant })}
      href={href}
      style={getUiButtonStyle({ side, size, style, variant })}
      tabIndex={disabled ? -1 : tabIndex}
      {...props}
    >
      <UiButtonShape />
      <span>{children}</span>
    </Link>
  );
}

export function UiButtonLabel({
  children,
  className,
  disabled = true,
  side,
  size,
  style,
  variant
}: UiButtonBaseProps) {
  return (
    <span
      aria-disabled={disabled}
      className={getUiButtonClassName({ className, disabled, size, variant })}
      style={getUiButtonStyle({ side, size, style, variant })}
    >
      <UiButtonShape />
      <span>{children}</span>
    </span>
  );
}
