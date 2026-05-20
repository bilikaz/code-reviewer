// Pre-existing legacy helper. About to be deleted.

export function legacyTransform(input: string): string {
  const tmp = input.trim();
  return tmp.toLowerCase();
}

function helper(x: number): number {
  const tmp = x * 2;
  return tmp + 1;
}

export const NUMBER = helper(10);
