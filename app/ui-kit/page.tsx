import Link from "next/link";
import type { CSSProperties } from "react";

const buttonKinds = [
  ["neutral", "Neutral"],
  ["success", "Success"],
  ["danger", "Failure"]
] as const;

export default function UiKitPage() {
  return (
    <main className="app-shell">
      <section className="ui-kit-screen">
        <header className="ui-kit-topbar">
          <div>
            <strong>Hangar UI Kit</strong>
            <span>sprite-sliced interface test</span>
          </div>
          <Link className="sprite-button neutral" href="/battle">
            <span className="sprite-button-left" />
            <span className="sprite-button-mid">Battle</span>
            <span className="sprite-button-right" />
          </Link>
        </header>

        <section className="ui-kit-grid">
          <div className="ui-kit-card">
            <h2>Buttons</h2>
            <div className="ui-kit-row">
              {buttonKinds.map(([kind, label]) => (
                <button className={`sprite-button ${kind}`} key={kind}>
                  <span className="sprite-button-left" />
                  <span className="sprite-button-mid">{label}</span>
                  <span className="sprite-button-right" />
                </button>
              ))}
            </div>
            <button className="sprite-button neutral wide">
              <span className="sprite-button-left" />
              <span className="sprite-button-mid">Wide seamless repeated center</span>
              <span className="sprite-button-right" />
            </button>
          </div>

          <div className="ui-kit-card">
            <h2>Form</h2>
            <label className="sprite-input">
              <span>CALLSIGN</span>
              <input defaultValue="IRIS-07" />
            </label>
            <label className="sprite-dropdown">
              <span>MODULE</span>
              <select defaultValue="reactor">
                <option value="reactor">Small reactor</option>
                <option value="engine">Ion engine</option>
                <option value="laser">Laser turret</option>
              </select>
            </label>
            <label className="sprite-checkbox">
              <input type="checkbox" defaultChecked />
              <span className="sprite-checkbox-box" />
              Auto repair protocol
            </label>
          </div>

          <div className="ui-kit-card">
            <h2>Bars</h2>
            <div className="sprite-progress" style={{ "--value": "64%" } as CSSProperties}>
              <span />
            </div>
            <div className="sprite-slider" style={{ "--value": "58%" } as CSSProperties}>
              <span />
            </div>
          </div>

          <div className="sprite-popup">
            <h2>Popup Window</h2>
            <p>
              Heavy panel frame for modal content. Corners and borders are sourced from the generated hangar sprite kit.
            </p>
            <div className="ui-kit-row">
              <button className="sprite-button danger">
                <span className="sprite-button-left" />
                <span className="sprite-button-mid">Cancel</span>
                <span className="sprite-button-right" />
              </button>
              <button className="sprite-button success">
                <span className="sprite-button-left" />
                <span className="sprite-button-mid">Confirm</span>
                <span className="sprite-button-right" />
              </button>
            </div>
          </div>
        </section>

        <nav className="sprite-bottom-nav" aria-label="Demo navigation">
          <a>Hangar</a>
          <a className="active">Loadout</a>
          <a>Battle</a>
          <a>Market</a>
        </nav>

        <section className="ui-kit-sheet">
          <h2>Generated Reference + Seamless Technical Kit</h2>
          <img src="/assets/ui/hangar-ui-seamless-reference.png" alt="Generated hangar UI reference" />
          <img src="/assets/ui/scale9-kit/_contact.png" alt="Scale9 UI kit" />
        </section>
      </section>
    </main>
  );
}
