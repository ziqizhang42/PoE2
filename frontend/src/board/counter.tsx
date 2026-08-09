import type { Player } from "@poe2/rules";

type CounterProps = {
  player: Player;
  isSingleton: boolean;
  isLastMove: boolean;
};

/** Seat number and rings convey ownership, scoring, and recency without color alone. */
export function Counter({ player, isSingleton, isLastMove }: CounterProps) {
  return (
    <span
      aria-hidden="true"
      className={`num relative z-3 flex aspect-square w-[66%] items-center justify-center rounded-full text-[clamp(9px,1.7vw,13px)] leading-none font-semibold ${
        player === 1 ? "bg-pen-1 text-on-fill" : "bg-pen-2 text-on-pen-2"
      }`}
    >
      {player}
      {isSingleton ? (
        <span className="absolute -inset-[5px] rounded-full border-[1.5px] border-dotted border-ink-3" />
      ) : null}
      {isLastMove ? <span className="absolute -inset-1 rounded-full border-2 border-ink" /> : null}
    </span>
  );
}
