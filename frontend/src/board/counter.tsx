import type { Player } from "@poe2/rules";

type CounterProps = {
  player: Player;
  isSingleton: boolean;
  isLastMove: boolean;
};

/** Color conveys ownership; optional rings convey scoring and recency. */
export function Counter({ player, isSingleton, isLastMove }: CounterProps) {
  return (
    <span
      aria-hidden="true"
      data-player-color={player}
      className={`relative z-3 block aspect-square w-[66%] rounded-full ${
        player === 1 ? "bg-pen-1" : "bg-pen-2"
      }`}
    >
      {isSingleton ? (
        <span className="absolute -inset-[5px] rounded-full border-[1.5px] border-dotted border-ink-3" />
      ) : null}
      {isLastMove ? <span className="absolute -inset-1 rounded-full border-2 border-ink" /> : null}
    </span>
  );
}
