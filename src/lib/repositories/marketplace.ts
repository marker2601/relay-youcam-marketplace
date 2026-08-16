import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/lib/db/client";
import {
  eventBriefs,
  idempotencyKeys,
  listings,
  matches,
  mediaObjects,
  offers,
  tryOnJobs,
} from "@/lib/db/schema";
import type { GarmentCategory, TryOnJobStatus } from "@/lib/domain/contracts";
import { assignAssuranceRoles } from "@/lib/domain/assurance";
import { rankMatches, type MatchBrief, type MatchListing } from "@/lib/domain/matching";
import type { NormalizedYouCamError } from "@/lib/youcam/errors";

export interface CreateMatchesAndJobsInput {
  briefId: string;
  actorId: string;
  idempotencyKey: string;
  now: Date;
}

export interface CreatedJobGraph {
  briefId: string;
  matchIds: string[];
  offerIds: string[];
  jobIds: string[];
}

export interface ClaimedTryOnJob {
  id: string;
  matchId: string;
  status: TryOnJobStatus;
  attemptCount: number;
  sourceFileId: string | null;
  referenceFileId: string | null;
  externalTaskId: string | null;
  createdAt: Date;
  shopperId: string;
  garmentCategory: GarmentCategory;
  sourceObjectKey: string;
  sourceContentType: string;
  referenceObjectKey: string;
  referenceContentType: string;
}

interface ExpectedJobState {
  jobId: string;
  expectedStatus: TryOnJobStatus;
  expectedAttemptCount: number;
}

interface CompleteJobInput extends ExpectedJobState {
  ownerUserId: string;
  objectKey: string;
  contentType: "image/jpeg" | "image/png";
  byteSize: number;
  now: Date;
}

const idempotencyScope = "brief_matches";
const sourceMedia = alias(mediaObjects, "source_media");
const referenceMedia = alias(mediaObjects, "reference_media");

function requireUpdated(rows: Array<{ id: string }>): void {
  if (rows.length !== 1) {
    throw new Error("Try-on job changed concurrently");
  }
}

function distanceBetweenBands(
  left: "loop" | "west" | "north",
  right: "loop" | "west" | "north",
): number {
  if (left === right) {
    return 2;
  }
  const pair = new Set([left, right]);
  return pair.has("west") && pair.has("north") ? 8 : 5;
}

function toMatchBrief(brief: typeof eventBriefs.$inferSelect): MatchBrief {
  return {
    eventType: brief.eventType,
    eventWindow: { startDate: brief.eventDate, endDate: brief.eventDate },
    dressCode: brief.dressCode,
    garmentCategory: brief.garmentCategory,
    budgetMinCents: brief.budgetMinCents,
    budgetMaxCents: brief.budgetMaxCents,
    measurementProfile: brief.measurementProfile,
    radiusMiles: brief.radiusMiles,
    preferredColors: brief.preferredColors,
    styleTags: brief.styleTags,
  };
}

function toMatchListing(
  brief: typeof eventBriefs.$inferSelect,
  listing: typeof listings.$inferSelect,
): MatchListing {
  return {
    listingId: listing.id,
    status: listing.status,
    garmentCategory: listing.garmentCategory,
    measurements: listing.measurements,
    unavailableRanges: listing.unavailableRanges,
    rentalPriceCents: listing.rentalPriceCents,
    serviceRadiusMiles: listing.serviceRadiusMiles,
    distanceMiles: distanceBetweenBands(brief.locationBand, listing.locationBand),
    colorTags: listing.colorTags,
    styleTags: listing.styleTags,
    reliabilityBasisPoints: listing.reliabilityBasisPoints,
  };
}

export class MarketplaceRepository {
  constructor(private readonly db: Database) {}

  private async rebalanceAssuranceRoles(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    failedMatchId: string,
  ): Promise<void> {
    const [failedMatch] = await transaction
      .select({ briefId: matches.briefId })
      .from(matches)
      .where(eq(matches.id, failedMatchId))
      .limit(1);
    if (!failedMatch) {
      throw new Error("Failed match was not found");
    }

    const survivors = await transaction
      .select({ id: offers.id, providerId: listings.providerId })
      .from(offers)
      .innerJoin(matches, eq(matches.id, offers.matchId))
      .innerJoin(eventBriefs, eq(eventBriefs.id, matches.briefId))
      .innerJoin(listings, eq(listings.id, matches.listingId))
      .where(
        and(
          eq(matches.briefId, failedMatch.briefId),
          eq(matches.briefRevision, eventBriefs.matchingRevision),
          notInArray(offers.status, ["failed", "expired"]),
        ),
      )
      .orderBy(desc(matches.scoreBasisPoints), asc(matches.listingId));
    const roles = assignAssuranceRoles(survivors);

    for (const survivor of survivors) {
      await transaction
        .update(offers)
        .set({ assuranceRole: roles.get(survivor.id) ?? "alternative" })
        .where(
          and(
            eq(offers.id, survivor.id),
            notInArray(offers.status, ["failed", "expired"]),
          ),
        );
    }
  }

  private async loadGraph(briefId: string): Promise<CreatedJobGraph> {
    const rows = await this.db
      .select({
        matchId: matches.id,
        offerId: offers.id,
        jobId: tryOnJobs.id,
      })
      .from(matches)
      .innerJoin(offers, eq(offers.matchId, matches.id))
      .innerJoin(tryOnJobs, eq(tryOnJobs.matchId, matches.id))
      .where(eq(matches.briefId, briefId))
      .orderBy(desc(matches.scoreBasisPoints), asc(matches.listingId));

    return {
      briefId,
      matchIds: rows.map((row) => row.matchId),
      offerIds: rows.map((row) => row.offerId),
      jobIds: rows.map((row) => row.jobId),
    };
  }

  async createMatchesAndJobs(input: CreateMatchesAndJobsInput): Promise<CreatedJobGraph> {
    await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, new Date(input.now.getTime() - 7 * 24 * 60 * 60_000)));

    const [existingKey] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.actorId, input.actorId),
          eq(idempotencyKeys.scope, idempotencyScope),
          eq(idempotencyKeys.key, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existingKey?.responseResourceId) {
      return this.loadGraph(existingKey.responseResourceId);
    }

    const result = await this.db.transaction(async (transaction) => {
      const [brief] = await transaction
        .select()
        .from(eventBriefs)
        .where(
          and(eq(eventBriefs.id, input.briefId), eq(eventBriefs.shopperId, input.actorId)),
        )
        .limit(1);
      if (!brief) {
        throw new Error("Brief was not found");
      }

      const [claimedKey] = await transaction
        .insert(idempotencyKeys)
        .values({
          actorId: input.actorId,
          scope: idempotencyScope,
          key: input.idempotencyKey,
          responseResourceId: brief.id,
          createdAt: input.now,
        })
        .onConflictDoNothing({
          target: [idempotencyKeys.actorId, idempotencyKeys.scope, idempotencyKeys.key],
        })
        .returning({ id: idempotencyKeys.id });
      if (!claimedKey) {
        const [winner] = await transaction
          .select({ responseResourceId: idempotencyKeys.responseResourceId })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.actorId, input.actorId),
              eq(idempotencyKeys.scope, idempotencyScope),
              eq(idempotencyKeys.key, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (!winner?.responseResourceId) {
          throw new Error("Idempotent command could not be resolved");
        }
        return { existingBriefId: winner.responseResourceId } as const;
      }

      const candidates = await transaction
        .select()
        .from(listings)
        .where(eq(listings.status, "active"));
      const ranked = rankMatches({
        brief: toMatchBrief(brief),
        listings: candidates.map((candidate) => toMatchListing(brief, candidate)),
      });
      const roles = assignAssuranceRoles(ranked.map((item) => ({
        id: item.listingId,
        providerId: candidates.find((candidate) => candidate.id === item.listingId)!.providerId,
      })));

      const graph: CreatedJobGraph = {
        briefId: brief.id,
        matchIds: [],
        offerIds: [],
        jobIds: [],
      };
      const expiresAt = new Date(input.now.getTime() + 24 * 60 * 60 * 1_000);

      for (const rankedMatch of ranked) {
        const listing = candidates.find((candidate) => candidate.id === rankedMatch.listingId)!;
        const [createdMatch] = await transaction
          .insert(matches)
          .values({
            briefId: brief.id,
            listingId: listing.id,
            briefRevision: brief.matchingRevision,
            listingVersion: listing.version,
            scoreBasisPoints: rankedMatch.score,
            scoreBreakdown: { ...rankedMatch.breakdown },
            explanation: rankedMatch.explanations,
            createdAt: input.now,
          })
          .returning({ id: matches.id });
        const [createdOffer] = await transaction
          .insert(offers)
          .values({
            matchId: createdMatch!.id,
            status: "matched",
            assuranceRole: roles.get(rankedMatch.listingId) ?? "alternative",
            expiresAt,
            createdAt: input.now,
          })
          .returning({ id: offers.id });
        const [createdJob] = await transaction
          .insert(tryOnJobs)
          .values({ matchId: createdMatch!.id, status: "queued", createdAt: input.now })
          .returning({ id: tryOnJobs.id });

        graph.matchIds.push(createdMatch!.id);
        graph.offerIds.push(createdOffer!.id);
        graph.jobIds.push(createdJob!.id);
      }

      await transaction
        .update(eventBriefs)
        .set({ status: ranked.length === 0 ? "no_matches" : "active", updatedAt: input.now })
        .where(
          and(
            eq(eventBriefs.id, brief.id),
            eq(eventBriefs.matchingRevision, brief.matchingRevision),
          ),
        );
      return graph;
    });

    return "existingBriefId" in result ? this.loadGraph(result.existingBriefId) : result;
  }

  async claimDueJobs(briefId: string, now: Date, requestedLimit = 3): Promise<ClaimedTryOnJob[]> {
    const limit = Math.min(3, Math.max(0, Math.floor(requestedLimit)));
    if (limit === 0) {
      return [];
    }

    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          id: tryOnJobs.id,
          matchId: tryOnJobs.matchId,
          status: tryOnJobs.status,
          attemptCount: tryOnJobs.attemptCount,
          sourceFileId: tryOnJobs.sourceFileId,
          referenceFileId: tryOnJobs.referenceFileId,
          externalTaskId: tryOnJobs.externalTaskId,
          nextPollAt: tryOnJobs.nextPollAt,
          createdAt: tryOnJobs.createdAt,
          shopperId: eventBriefs.shopperId,
          garmentCategory: listings.garmentCategory,
          sourceObjectKey: sourceMedia.objectKey,
          sourceContentType: sourceMedia.contentType,
          referenceObjectKey: referenceMedia.objectKey,
          referenceContentType: referenceMedia.contentType,
        })
        .from(tryOnJobs)
        .innerJoin(matches, eq(matches.id, tryOnJobs.matchId))
        .innerJoin(eventBriefs, eq(eventBriefs.id, matches.briefId))
        .innerJoin(listings, eq(listings.id, matches.listingId))
        .innerJoin(sourceMedia, eq(sourceMedia.id, eventBriefs.shopperMediaId))
        .innerJoin(referenceMedia, eq(referenceMedia.id, listings.garmentMediaId))
        .where(
          and(
            eq(matches.briefId, briefId),
            inArray(tryOnJobs.status, ["queued", "uploading", "processing"]),
            or(isNull(tryOnJobs.nextPollAt), lte(tryOnJobs.nextPollAt, now)),
          ),
        )
        .orderBy(asc(tryOnJobs.createdAt), asc(tryOnJobs.id))
        .limit(limit)
        .for("update", { of: tryOnJobs, skipLocked: true });

      const leaseUntil = new Date(now.getTime() + 2 * 60_000);
      for (const row of rows) {
        const updated = await transaction
          .update(tryOnJobs)
          .set({ nextPollAt: leaseUntil })
          .where(
            and(
              eq(tryOnJobs.id, row.id),
              eq(tryOnJobs.status, row.status),
              eq(tryOnJobs.attemptCount, row.attemptCount),
              row.nextPollAt
                ? eq(tryOnJobs.nextPollAt, row.nextPollAt)
                : isNull(tryOnJobs.nextPollAt),
            ),
          )
          .returning({ id: tryOnJobs.id });
        requireUpdated(updated);
        const offerUpdated = await transaction
          .update(offers)
          .set({ status: "generating" })
          .where(
            and(
              eq(offers.matchId, row.matchId),
              inArray(offers.status, ["matched", "generating"]),
            ),
          )
          .returning({ id: offers.id });
        requireUpdated(offerUpdated);
      }

      return rows;
    });
  }

  async recordSourceFile(input: ExpectedJobState & { fileId: string }): Promise<void> {
    const updated = await this.db
      .update(tryOnJobs)
      .set({ sourceFileId: input.fileId, status: "uploading", nextPollAt: null })
      .where(
        and(
          eq(tryOnJobs.id, input.jobId),
          eq(tryOnJobs.status, input.expectedStatus),
          eq(tryOnJobs.attemptCount, input.expectedAttemptCount),
          isNull(tryOnJobs.sourceFileId),
        ),
      )
      .returning({ id: tryOnJobs.id });
    requireUpdated(updated);
  }

  async recordReferenceFile(input: ExpectedJobState & { fileId: string }): Promise<void> {
    const updated = await this.db
      .update(tryOnJobs)
      .set({ referenceFileId: input.fileId, status: "uploading", nextPollAt: null })
      .where(
        and(
          eq(tryOnJobs.id, input.jobId),
          eq(tryOnJobs.status, input.expectedStatus),
          eq(tryOnJobs.attemptCount, input.expectedAttemptCount),
          isNotNull(tryOnJobs.sourceFileId),
          isNull(tryOnJobs.referenceFileId),
        ),
      )
      .returning({ id: tryOnJobs.id });
    requireUpdated(updated);
  }

  async recordExternalTask(input: ExpectedJobState & { externalTaskId: string }): Promise<void> {
    const updated = await this.db
      .update(tryOnJobs)
      .set({
        externalTaskId: input.externalTaskId,
        status: "processing",
        nextPollAt: null,
      })
      .where(
        and(
          eq(tryOnJobs.id, input.jobId),
          eq(tryOnJobs.status, input.expectedStatus),
          eq(tryOnJobs.attemptCount, input.expectedAttemptCount),
          isNotNull(tryOnJobs.sourceFileId),
          isNotNull(tryOnJobs.referenceFileId),
          isNull(tryOnJobs.externalTaskId),
        ),
      )
      .returning({ id: tryOnJobs.id });
    requireUpdated(updated);
  }

  async schedulePoll(
    input: ExpectedJobState & { nextPollAt: Date },
  ): Promise<void> {
    const updated = await this.db
      .update(tryOnJobs)
      .set({ attemptCount: input.expectedAttemptCount + 1, nextPollAt: input.nextPollAt })
      .where(
        and(
          eq(tryOnJobs.id, input.jobId),
          eq(tryOnJobs.status, input.expectedStatus),
          eq(tryOnJobs.attemptCount, input.expectedAttemptCount),
        ),
      )
      .returning({ id: tryOnJobs.id });
    requireUpdated(updated);
  }

  async completeJob(input: CompleteJobInput): Promise<string> {
    return this.db.transaction(async (transaction) => {
      const [createdMedia] = await transaction
        .insert(mediaObjects)
        .values({
          ownerUserId: input.ownerUserId,
          kind: "try_on_result",
          objectKey: input.objectKey,
          contentType: input.contentType,
          byteSize: input.byteSize,
          jobId: input.jobId,
          createdAt: input.now,
        })
        .returning({ id: mediaObjects.id });
      const updated = await transaction
        .update(tryOnJobs)
        .set({
          status: "succeeded",
          resultMediaId: createdMedia!.id,
          nextPollAt: null,
          normalizedErrorCode: null,
          completedAt: input.now,
        })
        .where(
          and(
            eq(tryOnJobs.id, input.jobId),
            eq(tryOnJobs.status, input.expectedStatus),
            eq(tryOnJobs.attemptCount, input.expectedAttemptCount),
            isNotNull(tryOnJobs.externalTaskId),
            isNull(tryOnJobs.resultMediaId),
          ),
        )
        .returning({ id: tryOnJobs.id, matchId: tryOnJobs.matchId });
      requireUpdated(updated);
      const offerUpdated = await transaction
        .update(offers)
        .set({ status: "ready" })
        .where(and(eq(offers.matchId, updated[0]!.matchId), eq(offers.status, "generating")))
        .returning({ id: offers.id });
      requireUpdated(offerUpdated);
      return createdMedia!.id;
    });
  }

  async failJob(
    input: ExpectedJobState & { code: NormalizedYouCamError; now: Date },
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const updated = await transaction
        .update(tryOnJobs)
        .set({
          status: "failed",
          normalizedErrorCode: input.code,
          nextPollAt: null,
          completedAt: input.now,
        })
        .where(
          and(
            eq(tryOnJobs.id, input.jobId),
            eq(tryOnJobs.status, input.expectedStatus),
            eq(tryOnJobs.attemptCount, input.expectedAttemptCount),
          ),
        )
        .returning({ id: tryOnJobs.id, matchId: tryOnJobs.matchId });
      requireUpdated(updated);
      const offerUpdated = await transaction
        .update(offers)
        .set({ status: "failed" })
        .where(
          and(
            eq(offers.matchId, updated[0]!.matchId),
            eq(offers.status, "generating"),
          ),
        )
        .returning({ id: offers.id });
      requireUpdated(offerUpdated);
      await this.rebalanceAssuranceRoles(transaction, updated[0]!.matchId);
    });
  }
}
