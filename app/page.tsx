import HomeSceneCanvas from "@/components/home/HomeSceneCanvas";
import { UiLinkButton } from "@/components/ui-kit/UiButton";

export default function HomePage() {
  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--home home-scene-frame">
        <div className="home-scene-host">
          <HomeSceneCanvas />
          <div className="home-scene-overlay">
            <div className="home-scene-actions">
              <UiLinkButton href="/hangar#contracts" variant="secondary">
                Contracts
              </UiLinkButton>
              <UiLinkButton href="/hangar" variant="primary">
                Hangar
              </UiLinkButton>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
