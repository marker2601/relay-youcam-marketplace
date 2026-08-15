import { S3Client } from "@aws-sdk/client-s3";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { OfferProgress } from "@/components/offers/offer-progress";
import { demoSessionCookieName, readDemoSession } from "@/lib/auth/demo-session";
import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type DatabaseConnection } from "@/lib/db/client";
import { BriefRepository, NotFoundError } from "@/lib/repositories/briefs";
import { getAuthorizedOfferSnapshot } from "@/lib/repositories/offer-read";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

let connection: DatabaseConnection | undefined;
let objectStore: S3ObjectStore | undefined;

function runtimeDependencies() {
  const env = getServerEnv();
  connection ??= createDatabaseConnection(env.DATABASE_URL);
  objectStore ??= new S3ObjectStore({
    client: new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
    bucket: env.S3_BUCKET,
  });
  return { env, db: connection.db, objectStore };
}

async function loadAuthorizedBrief(briefId: string) {
  const { env, db, objectStore: store } = runtimeDependencies();
  const cookieStore = await cookies();
  const session = readDemoSession(cookieStore.get(demoSessionCookieName)?.value, env.SESSION_SECRET);
  if (!session) redirect("/?returnTo=request");
  if (session.role !== "shopper") notFound();

  try {
    const actor = { userId: session.userId, role: session.role } as const;
    const [brief, snapshot] = await Promise.all([
      new BriefRepository(db).getById(actor, briefId),
      getAuthorizedOfferSnapshot(db, actor, briefId, store),
    ]);
    return { brief, snapshot };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function BriefOffersPage({
  params,
}: {
  params: Promise<{ briefId: string }>;
}) {
  const { briefId } = await params;
  const { brief, snapshot } = await loadAuthorizedBrief(briefId);

  return (
    <main className="offers-shell">
      <OfferProgress
        initialSnapshot={snapshot}
        initialRefinement={{
          radiusMiles: brief.radiusMiles,
          budgetMaxCents: brief.budgetMaxCents,
          garmentCategory: brief.garmentCategory,
          preferredColors: brief.preferredColors,
        }}
      />
    </main>
  );
}
