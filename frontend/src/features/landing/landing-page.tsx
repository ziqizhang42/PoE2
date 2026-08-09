import { HOME_TITLE, useDocumentTitle } from "../../app/document-title.ts";
import { LOBBY_PATH, SIGN_IN_PATH } from "../../app/routes.ts";
import { useSession } from "../../auth/queries.ts";
import { LinkButton } from "../../ui/button.tsx";
import { HERO, EYEBROW, LEDE } from "../../ui/classes.ts";
import { Demonstration } from "./demonstration.tsx";

export function LandingPage() {
  useDocumentTitle(HOME_TITLE);
  const session = useSession();
  // Hold the action row until a restored session can choose its destination.
  const resolved = session.data !== undefined || session.isError;
  const signedIn = session.data !== undefined && session.data !== null;

  return (
    <div>
      <section className="grid items-center gap-8 py-10 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)] lg:gap-12">
        <div>
          <p className={EYEBROW}>Powers of Exponent 2</p>
          <h1 className={HERO}>
            Seven by seven.
            <br />
            Forty-nine placements.
            <br />
            Decided by <span className="num">½</span>.
          </h1>
          <p className={LEDE}>
            Every straight run of your pieces is worth <span className="num">2ⁿ⁻¹</span>, in four
            directions at once, and pieces never move. Filling the board is easy. Knowing what the
            board is worth is not.
          </p>
          <div className="mt-8 flex min-h-[42px] flex-wrap items-center gap-3">
            {!resolved ? null : signedIn ? (
              <LinkButton to={LOBBY_PATH} variant="primary">
                Enter the lobby
              </LinkButton>
            ) : (
              <>
                <LinkButton to={SIGN_IN_PATH} variant="primary">
                  Sign in to play
                </LinkButton>
                <LinkButton to={`${SIGN_IN_PATH}?mode=register`}>Create an account</LinkButton>
              </>
            )}
          </div>
        </div>

        <Demonstration />
      </section>
    </div>
  );
}
