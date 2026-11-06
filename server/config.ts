import { z } from 'zod';

export const ServerConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  host: z.string().default('localhost'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export const config: ServerConfig = ServerConfigSchema.parse({
  port: process.env['PORT'],
  host: process.env['HOST'],
});
