// One key for a record keyed by several parts (a workspace and a path, a pull request number, a
// branch and its base): the parts as a JSON array, so no part can run into the next.

export function keyOf(...parts: ReadonlyArray<string | number>): string {
  return JSON.stringify(parts)
}
