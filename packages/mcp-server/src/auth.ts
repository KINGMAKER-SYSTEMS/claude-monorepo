import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { getEnv } from "@brain/shared";

// V1: the tailnet ACL is the boundary. When BRAIN_MCP_TOKEN is set, we
// additionally require an Authorization: Bearer <token> header. This is the
// seam for adding auth without restructuring request handling.
export function authorize(req: IncomingMessage): boolean {
  const token = getEnv().BRAIN_MCP_TOKEN;
  if (!token) return true;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length).trim());
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
