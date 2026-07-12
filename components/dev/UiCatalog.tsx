"use client";

import { useState } from "react";
import { FiActivity, FiBox, FiCrosshair, FiPlay, FiSettings, FiShield, FiZap } from "react-icons/fi";
import { MissionObjectiveHud } from "@/components/battle/MissionObjectiveHud";
import { WalletStrip } from "@/components/hangar/WalletStrip";
import {
  AchievementCard,
  CharacterCard,
  CyberIcon,
  HudCluster,
  Leaderboard,
  LevelTile,
  MissionCard,
  RewardSlot,
  SciFiButton,
  SciFiCheckbox,
  SciFiCloseButton,
  SciFiInput,
  SciFiModal,
  SciFiPanel,
  SciFiRadioGroup,
  SciFiSelect,
  SciFiSideMenu,
  SciFiSlider,
  SciFiToggle,
  SciFiTopNav,
  SegmentedBar,
  VictoryBanner,
  WeaponCard,
} from "@/components/sci-fi-ui/SciFiUi";
import { SlicedBanner, SlicedButton, SlicedCard } from "@/components/sci-fi-ui/SlicedUi";
import { VectorBanner, VectorButton, VectorCard, VectorInput, VectorPanel, VectorSegmentedBar } from "@/components/sci-fi-ui/VectorUi";
import { UiButton, UiButtonLabel, UiLinkButton } from "@/components/ui-kit/UiButton";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { BattleTelemetry } from "@/game/mission/runtime";
import type { MissionDef } from "@/game/mission/types";

const mission: MissionDef = {
  id: "credit-sweep",
  name: "Starter Scout",
  type: "salvage",
  risk: "yellow",
  briefing: "Clear the salvage lane and secure the contract.",
  durationSec: 90,
  objective: { type: "destroy_all", target: 4, label: "Clear rival salvagers" },
  hardRequirements: {},
  recommendations: { dps: 28, shield: 20 },
  hazards: ["debris field"],
  enemyKinds: ["scout"],
  rewards: { credits: 300, scrap: 12, bonuses: [] },
};

const telemetry: BattleTelemetry = {
  runtime: {
    attemptId: "ui-catalog",
    missionId: "credit-sweep",
    status: "active",
    elapsedSec: 28,
    remainingSec: 62,
    durationSec: 90,
    objective: { type: "destroy_all", progress: 2, target: 4 },
    enemiesTotal: 4,
    enemiesRemaining: 2,
    enemiesDestroyed: 2,
    damageTaken: 18,
    damagedPartIds: ["shield"],
    detachedPartIds: [],
  },
  vitals: {
    hull: { current: 82, max: 100 },
    shield: { current: 46, max: 100 },
    energy: { current: 68, max: 100 },
    heat: { current: 74, max: 100 },
  },
};

const colorTokens = ["void", "surface", "cyan", "violet", "success", "warning", "danger"] as const;

export function UiCatalog() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <main className="ui-catalog">
      <header className="ui-catalog-hero">
        <div>
          <span className="eyebrow">SpaceY design system · development source of truth</span>
          <h1>Game UI Catalog</h1>
          <p>Настраивайте компоненты здесь, затем используйте эти же exports на игровых страницах.</p>
        </div>
        <nav aria-label="Catalog sections">
          <a href="#foundations">Tokens</a>
          <a href="#actions">Actions</a>
          <a href="#forms">Forms</a>
          <a href="#cards">Cards</a>
          <a href="#overlays">Overlays</a>
          <a href="#hud">HUD</a>
        </nav>
      </header>

      <CatalogSection id="foundations" title="Foundations" note="Palette, typography, icons and surface hierarchy">
        <div className="ui-catalog-token-grid">
          {colorTokens.map((token) => (
            <article className="ui-catalog-token" data-token={token} key={token}>
              <i />
              <strong>{token}</strong>
              <small>--ui-{token}</small>
            </article>
          ))}
        </div>
        <div className="ui-catalog-type-grid">
          <div><small>Display</small><h2>CONTRACT READY</h2></div>
          <div><small>Heading</small><h3>Server Ship Assembly</h3></div>
          <div><small>Body</small><p>Readable telemetry and mission information over a moving game surface.</p></div>
          <div className="ui-catalog-icon-row" aria-label="Icon language">
            <FiPlay /><FiCrosshair /><FiShield /><FiZap /><FiBox /><FiActivity /><FiSettings />
          </div>
        </div>
      </CatalogSection>

      <CatalogSection id="actions" title="Actions and navigation" note="Primary, secondary, danger, disabled, icon and link states">
        <div className="ui-catalog-row">
          <UiButton variant="primary"><FiPlay /> Deploy</UiButton>
          <UiButton variant="secondary">Configure</UiButton>
          <UiButton disabled>Unavailable</UiButton>
          <UiButton size="sm" variant="primary">Compact</UiButton>
          <UiButton aria-label="Target" size="icon"><FiCrosshair /></UiButton>
          <UiLinkButton href="/dev/ui" variant="secondary">Hangar preview</UiLinkButton>
          <UiButtonLabel>Read only</UiButtonLabel>
        </div>
        <div className="ui-catalog-row">
          <SciFiButton icon="target" variant="active">Engage</SciFiButton>
          <SciFiButton variant="dark">Secondary</SciFiButton>
          <SciFiButton variant="danger">Abandon</SciFiButton>
          <SciFiButton variant="ghost">Ghost</SciFiButton>
          <SciFiCloseButton />
        </div>
        <SciFiTopNav items={[{ label: "Hangar", active: true }, { label: "Contracts", alert: true }, { label: "Research" }, { label: "Crew" }]} />
        <SciFiSideMenu items={[{ label: "Structure", active: true }, { label: "Weapons" }, { label: "Engines" }, { label: "Power" }]} />
      </CatalogSection>

      <CatalogSection id="forms" title="Inputs and controls" note="Default, selected, checked and quantitative controls">
        <div className="ui-catalog-form-grid">
          <SciFiInput label="Ship name" value="Contract Breaker" />
          <SciFiSelect label="Battle region" value="EU West" />
          <SciFiSlider label="Master volume" value={64} />
          <SciFiToggle checked label="Combat telemetry" />
          <SciFiToggle label="Reduced motion" />
          <SciFiCheckbox checked label="Auto target" />
          <SciFiCheckbox label="Show grid" />
          <SciFiRadioGroup active="Balanced" label="Power priority" options={["Weapons", "Balanced", "Engines"]} />
          <VectorInput aria-label="Vector input" defaultValue="Vector field" />
        </div>
      </CatalogSection>

      <CatalogSection id="feedback" title="Status, progress and economy" note="Operational messages, resource values and battle telemetry">
        <div className="ui-catalog-status-grid">
          <div className="ui-catalog-status" data-tone="success"><strong>Ready</strong><span>Build validated</span></div>
          <div className="ui-catalog-status" data-tone="warning"><strong>Warning</strong><span>Heat near limit</span></div>
          <div className="ui-catalog-status" data-tone="danger"><strong>Blocked</strong><span>Core disconnected</span></div>
          <div className="ui-catalog-status"><strong>Loading</strong><span>Synchronizing server state…</span></div>
        </div>
        <WalletStrip wallet={{ credits: 12840, scrap: 376, alloy: 48, dataShards: 12 }} />
        <div className="ui-catalog-meter-grid">
          <SegmentedBar label="Hull integrity" value={82} />
          <SegmentedBar label="Shield charge" value={46} />
          <SegmentedBar label="Weapon heat" value={74} />
          <VectorSegmentedBar value={68} />
        </div>
      </CatalogSection>

      <CatalogSection id="cards" title="Cards and selectable content" note="Missions, modules, progression, crew and rewards">
        <div className="ui-catalog-card-grid">
          <MissionCard active copy="Clear all rival salvagers" title="Starter Scout" variant={1} />
          <MissionCard copy="Protect the convoy for 60 seconds" title="Convoy Guard" variant={2} />
          <WeaponCard active power={42} title="Autocannon" />
          <WeaponCard power={68} title="Laser Turret" />
          <CharacterCard name="Ihor Sokolov" role="Pilot" selected variant={1} />
          <AchievementCard progress={72} subtitle="Complete 10 contracts" title="Pathfinder" />
          <AchievementCard locked title="Classified" />
        </div>
        <div className="ui-catalog-row">
          <LevelTile active number={1} stars={3} />
          <LevelTile number={2} stars={2} />
          <LevelTile locked number={3} />
          <RewardSlot count="+300" icon="currency" />
          <RewardSlot count="+12" icon="shard" />
        </div>
      </CatalogSection>

      <CatalogSection id="overlays" title="Panels, modal and Drawer" note="Disclosure layers for dense mobile game information">
        <div className="ui-catalog-panel-grid">
          <SciFiPanel eyebrow="Authority" footer={<SciFiButton variant="active">Apply</SciFiButton>} title="Server command">
            <p>Panel content uses the same chrome and spacing rules as the game screens.</p>
          </SciFiPanel>
          <SciFiModal actions={<><SciFiButton variant="active">Confirm</SciFiButton><SciFiButton variant="dark">Cancel</SciFiButton></>} title="Launch contract">
            <p>Starter Scout will occupy this build until the authoritative battle is finalized.</p>
          </SciFiModal>
        </div>
        <UiButton onClick={() => setDrawerOpen(true)} variant="primary">Open Drawer</UiButton>
        <Drawer onOpenChange={setDrawerOpen} open={drawerOpen} swipeDirection="down">
          <DrawerContent>
            <DrawerHeader>
              <div><DrawerTitle>Inventory</DrawerTitle><DrawerDescription>Reusable bottom sheet with production mobile behavior</DrawerDescription></div>
              <DrawerClose className="mobile-drawer-close">×</DrawerClose>
            </DrawerHeader>
            <div className="ui-catalog-drawer-demo"><WeaponCard active power={68} title="Laser Turret" /><WeaponCard power={42} title="Autocannon" /></div>
            <DrawerFooter><UiButton variant="primary">Install selected</UiButton></DrawerFooter>
          </DrawerContent>
        </Drawer>
      </CatalogSection>

      <CatalogSection id="hud" title="Battle HUD and results" note="Elements that must remain readable above the active playfield">
        <div className="ui-catalog-hud-stage">
          <MissionObjectiveHud mission={mission} telemetry={telemetry} />
          <HudCluster />
        </div>
        <div className="ui-catalog-banner-row">
          <VictoryBanner />
          <VectorBanner label="MISSION FAILED" tone="danger" />
        </div>
        <Leaderboard rows={[
          { rank: 1, player: "ION-7", kills: 18, deaths: 2, assists: 6, active: true },
          { rank: 2, player: "NOVA", kills: 14, deaths: 4, assists: 8 },
          { rank: 3, player: "SABLE", kills: 11, deaths: 5, assists: 9 },
        ]} />
      </CatalogSection>

      <CatalogSection id="legacy" title="Vector and sliced primitives" note="Existing asset-backed chrome retained for comparison and migration">
        <div className="ui-catalog-row">
          <VectorButton>Vector action</VectorButton>
          <VectorButton tone="dark">Vector secondary</VectorButton>
          <SlicedButton>Asset action</SlicedButton>
          <SlicedButton variant="dark">Asset secondary</SlicedButton>
        </div>
        <div className="ui-catalog-legacy-grid">
          <VectorPanel height={220} title="Vector panel" width={360}><p>Scalable code-native chrome.</p></VectorPanel>
          <VectorCard height={220} width={150}><CyberIcon name="lock" /></VectorCard>
          <SlicedCard><CyberIcon name="question" /></SlicedCard>
        </div>
        <div className="ui-catalog-banner-row"><SlicedBanner label="VICTORY" /><SlicedBanner label="DEFEAT" variant="defeat" /></div>
      </CatalogSection>
    </main>
  );
}

function CatalogSection({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="ui-catalog-section" id={id}>
      <header><span>{id}</span><h2>{title}</h2><p>{note}</p></header>
      <div className="ui-catalog-section-body">{children}</div>
    </section>
  );
}
