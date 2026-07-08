import Link from "next/link";
import HomeSceneCanvas from "@/components/home/HomeSceneCanvas";

export default function HomePage() {
  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--home home-scene-frame">
        <div className="home-scene-host">
          <HomeSceneCanvas />
          <div className="home-scene-overlay">
            <div className="home-scene-actions">
              <Link className="button" href="/battle">
                Бой
              </Link>
              <Link className="button primary" href="/hangar">
                Ангар
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
