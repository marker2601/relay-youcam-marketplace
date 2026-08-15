import {
  readDemoSession,
  sessionTokenFromCookieHeader,
  type Actor,
} from "@/lib/auth/demo-session";

export function actorFromRequest(
  request: Request,
  sessionSecret: string,
  nowMs = Date.now(),
): Actor | null {
  const session = readDemoSession(
    sessionTokenFromCookieHeader(request.headers.get("cookie")),
    sessionSecret,
    nowMs,
  );
  return session ? { userId: session.userId, role: session.role } : null;
}
