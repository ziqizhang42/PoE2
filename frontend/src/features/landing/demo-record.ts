/** Legal, complete demonstration record; every displayed value is derived from it. */

import { parseSquare, type Square } from "@poe2/rules";

export const DEMO_NOTATION: readonly string[] = [
  "a2",
  "g4",
  "c3",
  "b2",
  "b3",
  "b4",
  "a3",
  "c4",
  "g5",
  "c5",
  "a4",
  "b5",
  "a5",
  "a6",
  "a1",
  "b6",
  "f3",
  "g6",
  "d3",
  "e3",
  "c6",
  "b7",
  "d4",
  "a7",
  "c2",
  "d5",
  "e4",
  "e5",
  "f5",
  "f4",
  "e2",
  "b1",
  "d2",
  "d6",
  "g1",
  "f7",
  "d1",
  "e6",
  "f6",
  "e7",
  "c1",
  "c7",
  "d7",
  "g3",
  "f2",
  "g2",
  "e1",
  "f1",
  "g7",
];

export const DEMO_MOVES: readonly Square[] = DEMO_NOTATION.map((text) => {
  const square = parseSquare(text);
  if (square === null) {
    throw new RangeError(`${text} is not a square`);
  }
  return square;
});
