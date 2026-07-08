import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type IconName =
  | "x"
  | "chevron-left"
  | "chevron-right"
  | "caret-down"
  | "lock"
  | "star"
  | "currency"
  | "question"
  | "target"
  | "arrow-up"
  | "shard";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function CyberIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={cx("cyber-icon", className)} viewBox="0 0 24 24" aria-hidden="true">
      {name === "x" && (
        <>
          <path d="M5 5l14 14M19 5 5 19" />
          <circle cx="12" cy="12" r="9" />
        </>
      )}
      {name === "chevron-left" && <path d="m15 5-7 7 7 7" />}
      {name === "chevron-right" && <path d="m9 5 7 7-7 7" />}
      {name === "caret-down" && <path d="m6 9 6 6 6-6" />}
      {name === "lock" && (
        <>
          <path d="M7 11h10v8H7z" />
          <path d="M9 11V8a3 3 0 0 1 6 0v3" />
        </>
      )}
      {name === "star" && (
        <path
          d="m12 3 2.6 5.4 6 .8-4.4 4.2 1.1 5.9L12 16.4l-5.3 2.9 1.1-5.9-4.4-4.2 6-.8L12 3z"
          className="cyber-icon-fill"
        />
      )}
      {name === "currency" && (
        <>
          <path d="M8 4h8l4 7-4 9H8l-4-9 4-7z" />
          <path d="M14 8h-3.5L9 12l1.5 4H14" />
        </>
      )}
      {name === "question" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M9.5 9a3 3 0 1 1 4.2 2.7c-1 .5-1.7 1.2-1.7 2.3" />
          <path d="M12 17.2v.2" />
        </>
      )}
      {name === "target" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </>
      )}
      {name === "arrow-up" && (
        <>
          <path d="m5 14 7-7 7 7" />
          <path d="m7 18 5-5 5 5" />
        </>
      )}
      {name === "shard" && <path d="m14 3-8 11 5-1-1 8 8-12-5 1 1-7z" className="cyber-icon-fill" />}
    </svg>
  );
}

export function SciFiButton({
  children,
  variant = "dark",
  icon,
  wide,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "dark" | "active" | "danger" | "ghost";
  icon?: IconName;
  wide?: boolean;
}) {
  return (
    <button className={cx("sci-button", `sci-button-${variant}`, wide && "sci-button-wide", className)} {...props}>
      {icon && <CyberIcon name={icon} />}
      <span>{children}</span>
    </button>
  );
}

export function SciFiCloseButton() {
  return (
    <button className="sci-close" aria-label="Close">
      <CyberIcon name="x" />
    </button>
  );
}

export function SciFiPanel({
  title,
  eyebrow,
  children,
  className,
  footer
}: {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <section className={cx("sci-panel", className)}>
      {title && (
        <header className="sci-panel-title">
          {eyebrow && <small>{eyebrow}</small>}
          <span>{title}</span>
        </header>
      )}
      <div className="sci-panel-body">{children}</div>
      {footer && <footer className="sci-panel-footer">{footer}</footer>}
    </section>
  );
}

export function SciFiModal({
  title,
  children,
  actions,
  className
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("sci-modal", className)}>
      <SciFiCloseButton />
      <header className="sci-modal-title">{title}</header>
      <div className="sci-modal-body">{children}</div>
      {actions && <div className="sci-modal-actions">{actions}</div>}
    </div>
  );
}

export function SciFiTopNav({ items }: { items: Array<{ label: string; active?: boolean; alert?: boolean }> }) {
  return (
    <nav className="sci-top-nav" aria-label="Primary">
      {items.map((item) => (
        <a className={cx(item.active && "active")} key={item.label}>
          {item.label}
          {item.alert && <i />}
        </a>
      ))}
    </nav>
  );
}

export function SciFiSideMenu({ items }: { items: Array<{ label: string; active?: boolean }> }) {
  return (
    <nav className="sci-side-menu" aria-label="Section">
      {items.map((item) => (
        <button className={cx(item.active && "active")} key={item.label}>
          {item.active && <CyberIcon name="x" />}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function SciFiInput({ label, value }: { label: string; value: string }) {
  return (
    <label className="sci-field">
      <span>{label}</span>
      <input defaultValue={value} />
    </label>
  );
}

export function SciFiSelect({ label, value }: { label: string; value: string }) {
  return (
    <label className="sci-field sci-select">
      <span>{label}</span>
      <select defaultValue={value}>
        <option value={value}>{value}</option>
      </select>
      <CyberIcon name="caret-down" />
    </label>
  );
}

export function SciFiSlider({ label, value }: { label: string; value: number }) {
  return (
    <div className="sci-slider" style={{ "--value": `${value}%` } as CSSProperties}>
      <div className="sci-control-label">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="sci-slider-track">
        <i />
      </div>
    </div>
  );
}

export function SciFiToggle({ label, checked }: { label: string; checked?: boolean }) {
  return (
    <div className="sci-toggle">
      <span>{label}</span>
      <button className={cx(checked && "active")}>{checked ? "ON" : "OFF"}</button>
    </div>
  );
}

export function SciFiCheckbox({ label, checked }: { label: string; checked?: boolean }) {
  return (
    <label className="sci-check">
      <input type="checkbox" defaultChecked={checked} />
      <span />
      {label}
    </label>
  );
}

export function SciFiRadioGroup({
  label,
  options,
  active
}: {
  label: string;
  options: string[];
  active: string;
}) {
  return (
    <div className="sci-radio-group">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <label key={option}>
            <input name={label} type="radio" defaultChecked={option === active} />
            <i />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
}

export function SegmentedBar({
  label,
  value,
  segments = 24
}: {
  label: string;
  value: number;
  segments?: number;
}) {
  const active = Math.round((segments * value) / 100);

  return (
    <div className="sci-stat">
      <span>{label}</span>
      <div>
        {Array.from({ length: segments }).map((_, index) => (
          <i className={cx(index < active && "active")} key={index} />
        ))}
      </div>
      <b>{value}%</b>
    </div>
  );
}

export function LevelTile({
  number,
  stars,
  locked,
  active
}: {
  number: number;
  stars?: number;
  locked?: boolean;
  active?: boolean;
}) {
  return (
    <button className={cx("sci-level", active && "active", locked && "locked")}>
      <span>{String(number).padStart(2, "0")}</span>
      {locked ? (
        <CyberIcon name="lock" />
      ) : (
        <div>
          {Array.from({ length: 3 }).map((_, index) => (
            <CyberIcon className={cx(index < (stars ?? 0) && "active")} key={index} name="star" />
          ))}
        </div>
      )}
    </button>
  );
}

export function AchievementCard({
  title,
  subtitle,
  progress,
  locked,
  variant = "wings"
}: {
  title: string;
  subtitle?: string;
  progress?: number;
  locked?: boolean;
  variant?: "wings" | "eagle" | "valor";
}) {
  return (
    <article className={cx("sci-achievement", locked && "locked")}>
      <div className={cx("sci-badge", `sci-badge-${variant}`)}>
        {locked ? <CyberIcon name="question" /> : <span />}
      </div>
      {!locked && (
        <>
          <h3>{title}</h3>
          {progress !== undefined && <strong>{progress}%</strong>}
          <i />
          {subtitle && <p>{subtitle}</p>}
        </>
      )}
    </article>
  );
}

export function CharacterCard({
  name,
  role,
  selected,
  variant
}: {
  name: string;
  role: string;
  selected?: boolean;
  variant: 1 | 2 | 3 | 4 | 5;
}) {
  return (
    <article className={cx("sci-character", selected && "selected", `variant-${variant}`)}>
      <div className="sci-helmet" />
      <div>
        <h3>{name}</h3>
        <i />
        <p>{role}</p>
      </div>
    </article>
  );
}

export function MissionCard({
  title,
  copy,
  active,
  variant
}: {
  title: string;
  copy: string;
  active?: boolean;
  variant: 1 | 2 | 3;
}) {
  return (
    <article className={cx("sci-mission", active && "active", `variant-${variant}`)}>
      <div className="sci-mission-art" />
      <div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
    </article>
  );
}

export function WeaponCard({
  title,
  power,
  active
}: {
  title: string;
  power: number;
  active?: boolean;
}) {
  return (
    <article className={cx("sci-weapon-card", active && "active")}>
      <div className="sci-weapon-shape" />
      <h3>{title}</h3>
      <p>power: {power}</p>
    </article>
  );
}

export function RewardSlot({ icon, count }: { icon: IconName; count?: string }) {
  return (
    <div className="sci-reward">
      {count && <b>{count}</b>}
      <CyberIcon name={icon} />
    </div>
  );
}

export function VictoryBanner({ label = "VICTORY" }: { label?: string }) {
  return (
    <div className="sci-victory">
      <div className="sci-victory-mark" />
      <strong>{label}</strong>
    </div>
  );
}

export function Leaderboard({
  rows
}: {
  rows: Array<{ rank: number; player: string; kills: number; deaths: number; assists: number; active?: boolean }>;
}) {
  return (
    <div className="sci-leaderboard">
      <div className="sci-leaderboard-head">
        <span>Ranks</span>
        <span>Players</span>
        <span>Kills</span>
        <span>Deaths</span>
        <span>Assists</span>
      </div>
      {rows.map((row) => (
        <div className={cx("sci-leaderboard-row", row.active && "active")} key={row.rank}>
          <span>{row.rank}</span>
          <strong>{row.player}</strong>
          <span>{row.kills}</span>
          <span>{row.deaths}</span>
          <span>{row.assists}</span>
        </div>
      ))}
    </div>
  );
}

export function HudCluster() {
  return (
    <div className="sci-hud-cluster">
      <div className="sci-joystick">
        <i />
      </div>
      <button>
        <CyberIcon name="arrow-up" />
      </button>
      <button>
        <CyberIcon name="target" />
      </button>
      <button className="large">
        <CyberIcon name="shard" />
      </button>
    </div>
  );
}
