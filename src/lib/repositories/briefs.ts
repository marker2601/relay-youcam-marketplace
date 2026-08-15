import { and, eq, inArray } from "drizzle-orm";

import type { Actor } from "@/lib/auth/demo-session";
import type { Database } from "@/lib/db/client";
import { eventBriefs } from "@/lib/db/schema";

export class NotFoundError extends Error {
  constructor() {
    super("Resource was not found");
    this.name = "NotFoundError";
  }
}

export class BriefRepository {
  constructor(private readonly db: Database) {}

  async getById(actor: Actor, briefId: string): Promise<typeof eventBriefs.$inferSelect> {
    if (actor.role !== "shopper") {
      throw new NotFoundError();
    }
    const [brief] = await this.db
      .select()
      .from(eventBriefs)
      .where(and(eq(eventBriefs.id, briefId), eq(eventBriefs.shopperId, actor.userId)))
      .limit(1);
    if (!brief) {
      throw new NotFoundError();
    }
    return brief;
  }

  async markDeleting(actor: Actor, briefId: string): Promise<void> {
    if (actor.role !== "shopper") {
      throw new NotFoundError();
    }
    const updated = await this.db
      .update(eventBriefs)
      .set({ status: "deleting", updatedAt: new Date() })
      .where(
        and(
          eq(eventBriefs.id, briefId),
          eq(eventBriefs.shopperId, actor.userId),
          inArray(eventBriefs.status, ["matching", "active", "no_matches", "deleting"]),
        ),
      )
      .returning({ id: eventBriefs.id });
    if (updated.length !== 1) {
      throw new NotFoundError();
    }
  }
}
