export const MAX_LINE_LENGTH = 7;

export function lineScore(length: number): number {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LINE_LENGTH) {
    throw new RangeError(`length must be an integer from 1 through ${MAX_LINE_LENGTH}`);
  }
  return 2 ** (length - 1);
}
