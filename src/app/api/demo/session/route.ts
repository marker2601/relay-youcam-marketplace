import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  createDemoSession,
  serializeDemoSessionCookie,
} from "@/lib/auth/demo-session";
import { getServerEnv } from "@/lib/config/env";
import { createDatabaseConnection, type Database, type DatabaseConnection } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";

const commandSchema = z.strictObject({ userId: z.uuid() });

export interface DemoSessionPostHandlerOptions {
  db: Database;
  sessionSecret: string;
  production: boolean;
  now?: () => number;
}

export function createDemoSessionPostHandler(options: DemoSessionPostHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ code: "invalid_request" }, { status: 400 });
    }
    const command = commandSchema.safeParse(body);
    if (!command.success) {
      return Response.json({ code: "invalid_request" }, { status: 400 });
    }

    const [user] = await options.db
      .select({ id: users.id, role: users.demoRole })
      .from(users)
      .where(eq(users.id, command.data.userId))
      .limit(1);
    if (!user) {
      return Response.json({ code: "not_found" }, { status: 404 });
    }

    const token = createDemoSession(
      { userId: user.id, role: user.role },
      options.sessionSecret,
      options.now?.() ?? Date.now(),
    );
    return new Response(null, {
      status: 303,
      headers: {
        Location: user.role === "shopper" ? "/request/new" : "/provider",
        "Set-Cookie": serializeDemoSessionCookie(token, options.production),
      },
    });
  };
}

let connection: DatabaseConnection | undefined;

export async function POST(request: Request): Promise<Response> {
  const env = getServerEnv();
  connection ??= createDatabaseConnection(env.DATABASE_URL);
  return createDemoSessionPostHandler({
    db: connection.db,
    sessionSecret: env.SESSION_SECRET,
    production: process.env.NODE_ENV === "production",
  })(request);
}
