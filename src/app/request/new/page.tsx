import { BriefFormWithRouter } from "@/components/brief/brief-form-with-router";

export default function NewBriefPage() {
  return (
    <main className="request-shell">
      <header>
        <p className="eyebrow">One request, three local options</p>
        <h1>What are you dressing for?</h1>
        <p className="lede">
          Tell Relay about the occasion, the measurements that matter, and what you want to see.
        </p>
      </header>
      <BriefFormWithRouter />
    </main>
  );
}
