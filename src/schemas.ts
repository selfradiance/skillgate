import { z } from "zod";

export const ManifestObjectSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    tools: z.unknown().optional(),
    commands: z.unknown().optional(),
    capabilities: z.unknown().optional(),
    permissions: z.unknown().optional(),
    allowed_domains: z.unknown().optional(),
    allowedDomains: z.unknown().optional(),
    domains: z.unknown().optional(),
    hooks: z.unknown().optional(),
    command_hooks: z.unknown().optional(),
    commandHooks: z.unknown().optional(),
    skill: z.unknown().optional(),
    skills: z.unknown().optional()
  })
  .passthrough();

export type ManifestObject = z.infer<typeof ManifestObjectSchema>;
