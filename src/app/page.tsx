import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <p className="eyebrow">Circular occasionwear, on demand</p>
      <h1>Post the event. See yourself in the options. Rent the winner.</h1>
      <p className="lede">
        Relay matches one event brief with available pieces from local closets and rental
        boutiques, then uses virtual try-on to make the shortlist tangible.
      </p>
      <nav aria-label="Get started" className="home-actions">
        <Link className="primary-action" href="/request/new">
          Shop as a guest
        </Link>
        <Link className="secondary-action" href="/provider">
          Supply your closet
        </Link>
      </nav>
    </main>
  );
}
