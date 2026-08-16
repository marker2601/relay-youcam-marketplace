import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  BriefDeletionControl,
  BriefForm,
  BriefSubmissionError,
  type SubmitBrief,
} from "@/components/brief/brief-form";

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Event date"), "2026-09-20");
  await user.clear(screen.getByLabelText("Event time (Chicago)"));
  await user.type(screen.getByLabelText("Event time (Chicago)"), "19:00");
  await user.type(screen.getByLabelText("Minimum budget (USD)"), "50");
  await user.type(screen.getByLabelText("Maximum budget (USD)"), "120");
  await user.type(screen.getByLabelText("Size label"), "M");
  await user.type(screen.getByLabelText("Bust (cm)"), "90");
  await user.type(screen.getByLabelText("Waist (cm)"), "72");
  await user.type(screen.getByLabelText("Hips (cm)"), "98");
  await user.type(screen.getByLabelText("Preferred colors"), "emerald, navy");
  await user.type(screen.getByLabelText("Style tags"), "minimal, polished");
  const photo = new File([new Uint8Array([1, 2, 3])], "source.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("Full-body photo"), photo);
  await user.click(screen.getByLabelText(/I consent to Relay processing/i));
}

describe("BriefForm", () => {
  it("renders the complete three-section request and official capture guidance", () => {
    render(<BriefForm submitBrief={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Your event" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your measurements" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your photo" })).toBeInTheDocument();
    expect(screen.getByText(/JPEG or PNG/i)).toBeInTheDocument();
    expect(screen.getByText(/under 10 MB/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 512×384/i)).toBeInTheDocument();
    expect(screen.getByText(/one forward-facing adult/i)).toBeInTheDocument();
    expect(screen.getByText(/automatic person and composition checks happen at YouCam/i)).toBeInTheDocument();
  });

  it("shows inline errors and does not submit when required values are missing", async () => {
    const user = userEvent.setup();
    const submitBrief = vi.fn<SubmitBrief>();
    render(<BriefForm submitBrief={submitBrief} />);

    await user.click(screen.getByRole("button", { name: "Find my matches" }));

    expect(screen.getByText("Choose your event date.")).toBeInTheDocument();
    expect(screen.getByText("Add a full-body photo.")).toBeInTheDocument();
    expect(screen.getByText("Consent is required before upload.")).toBeInTheDocument();
    expect(submitBrief).not.toHaveBeenCalled();
  });

  it("shows a selected photo preview and lets the shopper remove it", async () => {
    const user = userEvent.setup();
    render(<BriefForm submitBrief={vi.fn()} />);
    const photo = new File([new Uint8Array([1])], "relay-look.png", { type: "image/png" });

    await user.upload(screen.getByLabelText("Full-body photo"), photo);
    expect(screen.getByText("relay-look.png selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.queryByText("relay-look.png selected")).not.toBeInTheDocument();
  });

  it("disables submission while the request is pending", async () => {
    const user = userEvent.setup();
    let resolve!: (value: { briefId: string }) => void;
    const submitBrief = vi.fn<SubmitBrief>(
      () => new Promise((complete) => { resolve = complete; }),
    );
    render(<BriefForm submitBrief={submitBrief} onCreated={vi.fn()} />);
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: "Find my matches" }));
    expect(screen.getByRole("button", { name: "Find my matches" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Finding matches");
    resolve({ briefId: "11111111-1111-4111-8111-111111111111" });
  });

  it("preserves all non-photo fields after an invalid-image response", async () => {
    const user = userEvent.setup();
    const submitBrief = vi.fn<SubmitBrief>().mockRejectedValue(
      new BriefSubmissionError("too_small", "Choose an image at least 512 pixels wide."),
    );
    render(<BriefForm submitBrief={submitBrief} />);
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: "Find my matches" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("at least 512 pixels");
    expect(screen.getByLabelText("Event date")).toHaveValue("2026-09-20");
    expect(screen.getByLabelText("Event time (Chicago)")).toHaveValue("19:00");
    expect(screen.getByLabelText("Size label")).toHaveValue("M");
    expect(screen.getByLabelText("Bust (cm)")).toHaveValue(90);
    expect(screen.queryByText("source.png selected")).not.toBeInTheDocument();
  });

  it("hands the returned brief to navigation after a successful submission", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const submitBrief = vi
      .fn<SubmitBrief>()
      .mockResolvedValue({ briefId: "11111111-1111-4111-8111-111111111111" });
    render(<BriefForm submitBrief={submitBrief} onCreated={onCreated} />);
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: "Find my matches" }));

    expect(onCreated).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("submits the shopper's Chicago event time as an ISO timestamp", async () => {
    const user = userEvent.setup();
    const submitBrief = vi.fn<SubmitBrief>().mockResolvedValue({
      briefId: "11111111-1111-4111-8111-111111111111",
    });
    render(<BriefForm submitBrief={submitBrief} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Find my matches" }));

    const payload = submitBrief.mock.calls[0]?.[0];
    expect(JSON.parse(String(payload?.get("command")))).toMatchObject({
      eventDate: "2026-09-20",
      eventStartsAt: expect.stringMatching(/^2026-09-2[01]T/),
    });
  });

  it("shows an inline error instead of submitting a nonexistent Chicago wall time", async () => {
    const user = userEvent.setup();
    const submitBrief = vi.fn<SubmitBrief>();
    render(<BriefForm submitBrief={submitBrief} />);

    await fillRequired(user);
    const eventDate = screen.getByLabelText("Event date");
    const eventTime = screen.getByLabelText("Event time (Chicago)");
    await user.clear(eventDate);
    await user.type(eventDate, "2027-03-14");
    await user.clear(eventTime);
    await user.type(eventTime, "02:30");
    await user.click(screen.getByRole("button", { name: "Find my matches" }));

    expect(screen.getByText("Choose a Chicago time that exists and occurs only once.")).toBeInTheDocument();
    expect(submitBrief).not.toHaveBeenCalled();
  });
});

describe("BriefDeletionControl", () => {
  it("requires explicit confirmation and shows the upstream-retention distinction", async () => {
    const user = userEvent.setup();
    const deleteBrief = vi.fn().mockResolvedValue({
      status: "deleted" as const,
      message:
        "Relay has deleted its stored copies. Perfect Corp. may retain API files for up to 30 days under its documented policy.",
    });
    render(
      <BriefDeletionControl
        briefId="11111111-1111-4111-8111-111111111111"
        deleteBrief={deleteBrief}
      />,
    );

    const button = screen.getByRole("button", { name: "Delete my Relay images" });
    expect(button).toBeDisabled();
    await user.click(screen.getByLabelText(/delete my uploaded photo and generated previews/i));
    await user.click(button);

    expect(deleteBrief).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("up to 30 days");
  });
});
