import { CARD, NOTE } from "../ui/classes.ts";

export function PagePending({ label }: { label: string }) {
  return (
    <div className="py-12">
      <div className={`${CARD} mx-auto max-w-md text-center`} role="status">
        <span
          aria-hidden="true"
          className="mx-auto mb-3 block h-6 w-6 animate-spin rounded-full border-2 border-line border-t-pen-1"
        />
        <p className={`${NOTE} mx-auto`}>{label}</p>
      </div>
    </div>
  );
}
