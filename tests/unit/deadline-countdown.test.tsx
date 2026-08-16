import { act, render, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeadlineCountdown } from "@/components/assurance/deadline-countdown";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DeadlineCountdown", () => {
  it("announces a ticking deadline politely and shows the completion state at zero", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));

    render(
      <DeadlineCountdown
        target="2026-08-16T12:00:02.000Z"
        completeLabel="Response window ended"
        prefix="Respond in"
      />,
    );

    const countdown = screen.getByText("Respond in 0m 2s");
    expect(countdown).toHaveAttribute("aria-live", "polite");

    act(() => vi.advanceTimersByTime(2_000));

    expect(screen.getByText("Response window ended")).toBeVisible();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps positive sub-second time visible until the terminal tick", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));

    render(
      <DeadlineCountdown
        target="2026-08-16T12:00:00.500Z"
        completeLabel="Response window ended"
        prefix="Respond in"
      />,
    );

    expect(screen.getByText("Respond in 0m 1s")).toBeVisible();

    act(() => vi.advanceTimersByTime(500));

    expect(screen.getByText("Response window ended")).toBeVisible();
  });

  it("hydrates clock-independent initial markup when server and client clocks differ", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.100Z"));
    const props = {
      target: "2026-08-16T12:00:02.000Z",
      completeLabel: "Response window ended",
      prefix: "Respond in",
    };
    const serverMarkup = renderToString(<DeadlineCountdown {...props} />);
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.append(container);
    vi.setSystemTime(new Date("2026-08-16T12:00:01.250Z"));
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...messages: unknown[]) => {
      errors.push(messages.map(String).join(" "));
    });
    let root: Root | undefined;

    expect(container).toHaveTextContent("Respond in …");
    act(() => {
      root = hydrateRoot(container, <DeadlineCountdown {...props} />);
    });

    expect(container).toHaveTextContent("Respond in 0m 1s");
    expect(errors.join(" ")).not.toMatch(/hydration|did not match|server rendered/i);

    act(() => root?.unmount());
    container.remove();
  });
});
