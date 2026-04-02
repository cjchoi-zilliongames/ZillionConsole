import { getAuthenticatedToolUser } from "@/lib/require-any-auth";

/** requireAnyAuth 직후 등, 이미 통과한 요청에서 사용자 이메일만 필요할 때 */
export async function getRequestUserEmail(req: Request): Promise<string> {
  const u = await getAuthenticatedToolUser(req);
  return u.email;
}
