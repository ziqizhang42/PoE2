import type { ReactNode } from "react";

import { formatSquare } from "@poe2/rules";

import { FILES, RANKS } from "./board-model.ts";

type BoardFrameProps = {
  labelled: boolean;
  sizeClass: string;
  children: ReactNode;
  overlay: ReactNode;
};

/** Role-neutral board geometry shared by interactive and decorative boards. */
export function BoardFrame({ labelled, sizeClass, children, overlay }: BoardFrameProps) {
  return (
    <div
      className={`mx-auto grid w-full gap-1.5 ${sizeClass} ${
        labelled
          ? "grid-cols-[1.25rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_1.125rem]"
          : "grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]"
      }`}
    >
      {labelled ? (
        <div className="grid grid-rows-7" aria-hidden="true">
          {RANKS.map((rank) => (
            <div key={rank} className="num flex items-center justify-center text-xs text-ink-3">
              {rank + 1}
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={`relative aspect-square min-w-0 rounded-lg bg-sunken p-[5px] ${
          labelled ? "col-start-2" : ""
        }`}
      >
        {children}
        {overlay}
      </div>

      {labelled ? (
        <>
          <div />
          <div className="col-start-2 grid grid-cols-7" aria-hidden="true">
            {FILES.map((col) => (
              <div key={col} className="num flex items-center justify-center text-xs text-ink-3">
                {formatSquare({ row: 0, col }).slice(0, 1)}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
