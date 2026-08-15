import { DemoEntryLink } from "@/components/demo-entry-link";

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
        <DemoEntryLink
          className="primary-action"
          href="/request/new"
          userId="30000000-0000-4000-8000-000000000001"
        >
          Shop as a guest
        </DemoEntryLink>
        <DemoEntryLink
          className="secondary-action"
          href="/provider"
          userId="30000000-0000-4000-8000-000000000004"
        >
          Supply your closet
        </DemoEntryLink>
      </nav>
    </main>
  );
}
