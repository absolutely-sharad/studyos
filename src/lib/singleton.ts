/**
 * One shared instance per process, even if the bundler loads this module more than once (Next.js can give
 * the instrumentation hook, each route and each server action their own copy). Limits that must hold for the
 * whole process, such as "three password checks at a time", live here instead of in module variables.
 */
export function singleton<T>(name: string, create: () => T): T {
  const key = Symbol.for(`studyos.${name}`);
  const store = globalThis as unknown as Record<symbol, T | undefined>;
  return (store[key] ??= create());
}
