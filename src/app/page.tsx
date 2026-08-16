import { DemoEntryLink } from "@/components/demo-entry-link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <p className="eyebrow">Event assurance, powered by local closets</p>
      <h1>Relay is the reliability layer for time-sensitive fashion.</h1>
      <p className="lede">
        Discovery apps show possibilities. Relay builds a primary look, a backup look, and an
        owner-confirmed path to your event.
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
