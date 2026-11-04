import { useQuery } from "@tanstack/react-query";
import type { ModRoles } from "@shared/social";
import { call } from "@/lib/sky";

export const rolesKey = ["mod-roles"] as const;
const NONE: ModRoles = { lyrics: false, workshop: false };

/** What this computer's moderator key may do (Settings → Messenger): review lyrics, look after the workshop, both. */
export function useModRoles(): ModRoles {
  return useQuery({ queryKey: rolesKey, queryFn: () => call("mod:roles"), staleTime: Infinity }).data ?? NONE;
}
