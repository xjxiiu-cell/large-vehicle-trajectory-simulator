import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
});

try {
  await server.ssrLoadModule('/scripts/verify-front-axle-continuity.ts');
  await server.ssrLoadModule('/scripts/verify-hybrid-planner-performance.ts');
} finally {
  await server.close();
}
