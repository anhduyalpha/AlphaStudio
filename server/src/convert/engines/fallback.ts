import { isFallbackEligible } from './errors.js';
import type { EngineRoute } from './types.js';

export async function executeEngineFallback<T>(
  routes: EngineRoute[],
  execute: (route: EngineRoute) => Promise<T>,
): Promise<{ result: T; route: EngineRoute; attemptedEngines: string[] }> {
  if (!routes.length) throw new Error('No conversion engine route is available');
  const attemptedEngines: string[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    attemptedEngines.push(route.engineId);
    try {
      return {
        result: await execute(route),
        route,
        attemptedEngines,
      };
    } catch (error) {
      if (!isFallbackEligible(error) || index === routes.length - 1) throw error;
    }
  }
  throw new Error('Conversion engine fallback exhausted');
}
