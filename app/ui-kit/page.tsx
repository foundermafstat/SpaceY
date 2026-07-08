import type { CSSProperties, ReactNode } from "react";
import {
  SlicedBanner,
  SlicedButton,
  SlicedCard,
  SlicedInputStack,
  SlicedPanel,
  SlicedStatic
} from "@/components/sci-fi-ui/SlicedUi";

function Slot({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  return (
    <div className="sliced-slot" style={{ left, top } as CSSProperties}>
      {children}
    </div>
  );
}

export default function UiKitPage() {
  return (
    <main className="sci-sheet-page">
      <section className="sliced-component-sheet" aria-label="Pixel-perfect sci-fi React components">
        <Slot left={248} top={82}>
          <SlicedStatic name="mini-tabs" />
        </Slot>

        <Slot left={420} top={82}>
          <SlicedButton side="left">Confirm</SlicedButton>
        </Slot>
        <Slot left={660} top={82}>
          <SlicedButton side="right">Deploy</SlicedButton>
        </Slot>
        <Slot left={420} top={130}>
          <SlicedButton side="left" variant="dark">Cancel</SlicedButton>
        </Slot>
        <Slot left={660} top={130}>
          <SlicedButton side="right" variant="dark">Options</SlicedButton>
        </Slot>

        <Slot left={245} top={210}>
          <SlicedStatic name="controls-strip" />
        </Slot>
        <Slot left={655} top={202}>
          <SlicedInputStack
            emailProps={{ defaultValue: "Ultra-Knight@gmail.com" }}
            passwordProps={{ defaultValue: "starframe" }}
          />
        </Slot>

        <Slot left={136} top={520}>
          <SlicedPanel title="Settings" variant="large">
            <p>Reusable panel body. Content stays code-native while the frame is pixel-sliced.</p>
          </SlicedPanel>
        </Slot>
        <Slot left={786} top={520}>
          <SlicedPanel variant="side">
            <SlicedButton side="left">Next</SlicedButton>
          </SlicedPanel>
        </Slot>
        <Slot left={176} top={960}>
          <SlicedPanel title="Login" variant="medium">
            <p>Modal shell with exact reference chrome.</p>
          </SlicedPanel>
        </Slot>
        <Slot left={194} top={1248}>
          <SlicedPanel variant="tall">
            <p>Inventory panel.</p>
          </SlicedPanel>
        </Slot>

        <Slot left={535} top={1138}>
          <SlicedCard side="left">
            <span>?</span>
          </SlicedCard>
        </Slot>
        <Slot left={672} top={1138}>
          <SlicedCard side="right">
            <span>?</span>
          </SlicedCard>
        </Slot>
        <Slot left={542} top={1406}>
          <SlicedStatic name="panel-card-stack" />
        </Slot>

        <Slot left={194} top={1642}>
          <SlicedStatic name="icons-row" />
        </Slot>
        <Slot left={158} top={1780}>
          <SlicedBanner label="VICTORY" />
        </Slot>
        <Slot left={618} top={1822}>
          <SlicedBanner label="DEFEAT" variant="defeat" />
        </Slot>
        <Slot left={178} top={2018}>
          <SlicedStatic name="progress-long" />
        </Slot>
        <Slot left={284} top={2178}>
          <SlicedStatic name="double-bars" />
        </Slot>
        <Slot left={326} top={2286}>
          <SlicedStatic name="small-panels" />
        </Slot>
        <Slot left={250} top={2548}>
          <SlicedStatic name="ruler" />
        </Slot>
        <Slot left={246} top={2660}>
          <SlicedStatic name="hud-top" />
        </Slot>
        <Slot left={260} top={2800}>
          <SlicedStatic name="hud-bottom" />
        </Slot>
      </section>
    </main>
  );
}
