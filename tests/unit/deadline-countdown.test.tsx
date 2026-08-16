import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeadlineCountdown } from "@/components/assurance/deadline-countdown";

afterEach(() => vi.useRealTimers());

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
  });
});
