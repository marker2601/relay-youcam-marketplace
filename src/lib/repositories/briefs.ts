import { and, eq, inArray } from "drizzle-orm";

import type { Actor } from "@/lib/auth/demo-session";
import type { Database } from "@/lib/db/client";
import { eventBriefs, matches, mediaObjects, tryOnJobs } from "@/lib/db/schema";

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
      .where(
        and(
          eq(eventBriefs.id, briefId),
          eq(eventBriefs.shopperId, actor.userId),
          inArray(eventBriefs.status, ["matching", "active", "no_matches"]),
        ),
      )
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

  async prepareDeletion(
    actor: Actor,
    briefId: string,
    now: Date,
  ): Promise<Array<{ id: string; objectKey: string }>> {
    if (actor.role !== "shopper") {
      throw new NotFoundError();
    }

    return this.db.transaction(async (transaction) => {
      const [brief] = await transaction
        .select()
        .from(eventBriefs)
        .where(and(eq(eventBriefs.id, briefId), eq(eventBriefs.shopperId, actor.userId)))
        .limit(1)
        .for("update");
      if (!brief) {
        throw new NotFoundError();
      }

      const sources = await transaction
        .select({ id: mediaObjects.id, objectKey: mediaObjects.objectKey })
        .from(mediaObjects)
        .where(
          and(
            eq(mediaObjects.briefId, briefId),
            eq(mediaObjects.ownerUserId, actor.userId),
            eq(mediaObjects.kind, "brief_source"),
            inArray(mediaObjects.deletionStatus, ["active", "deleting", "delete_failed"]),
          ),
        );
      const results = await transaction
        .select({ id: mediaObjects.id, objectKey: mediaObjects.objectKey })
        .from(mediaObjects)
        .innerJoin(tryOnJobs, eq(tryOnJobs.id, mediaObjects.jobId))
        .innerJoin(matches, eq(matches.id, tryOnJobs.matchId))
        .where(
          and(
            eq(matches.briefId, briefId),
            eq(mediaObjects.ownerUserId, actor.userId),
            eq(mediaObjects.kind, "try_on_result"),
            inArray(mediaObjects.deletionStatus, ["active", "deleting", "delete_failed"]),
          ),
        );
      const candidates = [...new Map([...sources, ...results].map((row) => [row.id, row])).values()];

      await transaction
        .update(tryOnJobs)
        .set({ resultMediaId: null })
        .where(
          inArray(
            tryOnJobs.matchId,
            transaction
              .select({ id: matches.id })
              .from(matches)
              .where(eq(matches.briefId, briefId)),
          ),
        );
      await transaction
        .update(eventBriefs)
        .set({ shopperMediaId: null, status: candidates.length === 0 ? "deleted" : "deleting", updatedAt: now })
        .where(and(eq(eventBriefs.id, briefId), eq(eventBriefs.shopperId, actor.userId)));
      if (candidates.length > 0) {
        await transaction
          .update(mediaObjects)
          .set({ deletionStatus: "deleting", deletionErrorCode: null })
          .where(inArray(mediaObjects.id, candidates.map((candidate) => candidate.id)));
      }

      return candidates;
    });
  }

  async recordDeletionResult(input: {
    mediaId: string;
    succeeded: boolean;
    now: Date;
  }): Promise<void> {
    await this.db
      .update(mediaObjects)
      .set(
        input.succeeded
          ? { deletionStatus: "deleted", deletionErrorCode: null, deletedAt: input.now }
          : {
              deletionStatus: "delete_failed",
              deletionErrorCode: "object_delete_failed",
              deletedAt: null,
            },
      )
      .where(eq(mediaObjects.id, input.mediaId));
  }

  async finishDeletion(actor: Actor, briefId: string, now: Date): Promise<"deleted" | "deleting"> {
    if (actor.role !== "shopper") {
      throw new NotFoundError();
    }
    const remainingSources = await this.db
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.briefId, briefId),
          eq(mediaObjects.ownerUserId, actor.userId),
          eq(mediaObjects.kind, "brief_source"),
          inArray(mediaObjects.deletionStatus, ["active", "deleting", "delete_failed"]),
        ),
      )
      .limit(1);
    const remainingResults = await this.db
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .innerJoin(tryOnJobs, eq(tryOnJobs.id, mediaObjects.jobId))
      .innerJoin(matches, eq(matches.id, tryOnJobs.matchId))
      .where(
        and(
          eq(matches.briefId, briefId),
          eq(mediaObjects.ownerUserId, actor.userId),
          eq(mediaObjects.kind, "try_on_result"),
          inArray(mediaObjects.deletionStatus, ["active", "deleting", "delete_failed"]),
        ),
      )
      .limit(1);
    const status = remainingSources.length === 0 && remainingResults.length === 0
      ? "deleted"
      : "deleting";
    const updated = await this.db
      .update(eventBriefs)
      .set({ status, updatedAt: now })
      .where(and(eq(eventBriefs.id, briefId), eq(eventBriefs.shopperId, actor.userId)))
      .returning({ id: eventBriefs.id });
    if (updated.length !== 1) {
      throw new NotFoundError();
    }
    return status;
  }
}
