import Link from "next/link";

export default function HomePage() {
  return (
    <main className="app-shell">
      <section className="mobile-frame">
        <div className="screen">
          <header className="topbar">
            <div className="brand">
              <strong>Starframe Arena</strong>
              <span>Builder combat MVP</span>
            </div>
            <span className="meta">9:16 prototype</span>
          </header>

          <div className="home-grid">
            <h1 className="hero-title">Собери корабль. Проверь его в бою.</h1>
            <p className="hero-copy">
              Первый вертикальный прототип: модульный ангар, расчет массы и энергии,
              инерционное движение, автооружие и survival-арена.
            </p>
            <Link className="button primary" href="/hangar">
              Открыть ангар
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
