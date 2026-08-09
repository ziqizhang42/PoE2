/** Pure implementation of Mark Glickman's Glicko-2 algorithm. */

const RATING_SCALE = 173.7178;
const CENTRE = 1500;

const CONVERGENCE = 0.000_001;

const MAX_ITERATIONS = 100;

export interface Rating {
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
}

export interface GlickoSystem {
  /** Smaller values of τ make volatility, and therefore ratings, steadier. */
  readonly tau: number;
}

export const DEFAULT_SYSTEM: GlickoSystem = { tau: 0.5 };

/** High initial deviation lets early results move the estimate quickly. */
export const INITIAL_RATING: Rating = { rating: CENTRE, deviation: 350, volatility: 0.06 };

export interface RatedOutcome {
  readonly opponent: Rating;
  /** 1 for a win, 0 for a loss. This game cannot be drawn, so never 0.5. */
  readonly score: number;
}

interface Internal {
  readonly mu: number;
  readonly phi: number;
  readonly sigma: number;
}

function toInternal(rating: Rating): Internal {
  return {
    mu: (rating.rating - CENTRE) / RATING_SCALE,
    phi: rating.deviation / RATING_SCALE,
    sigma: rating.volatility,
  };
}

function fromInternal(internal: Internal): Rating {
  return {
    rating: internal.mu * RATING_SCALE + CENTRE,
    deviation: internal.phi * RATING_SCALE,
    volatility: internal.sigma,
  };
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expected(mu: number, opponentMu: number, opponentPhi: number): number {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

/** Uses the paper's Illinois-variant regula falsi volatility solver. */
function solveVolatility(
  phi: number,
  sigma: number,
  v: number,
  delta: number,
  tau: number,
): number {
  const a = Math.log(sigma * sigma);
  const phiSquared = phi * phi;
  const deltaSquared = delta * delta;

  const f = (x: number): number => {
    const expX = Math.exp(x);
    const denominator = phiSquared + v + expX;

    return (
      (expX * (deltaSquared - phiSquared - v - expX)) / (2 * denominator * denominator) -
      (x - a) / (tau * tau)
    );
  };

  let lower = a;
  let upper: number;

  if (deltaSquared > phiSquared + v) {
    upper = Math.log(deltaSquared - phiSquared - v);
  } else {
    upper = a;
    let k = 1;
    while (f(a - k * tau) < 0 && k <= MAX_ITERATIONS) {
      k += 1;
    }
    lower = a - k * tau;
  }

  let fLower = f(lower);
  let fUpper = f(upper);

  if (fLower * fUpper > 0) {
    return sigma;
  }

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    if (Math.abs(upper - lower) <= CONVERGENCE) {
      break;
    }

    const mid = lower + ((lower - upper) * fLower) / (fUpper - fLower);
    const fMid = f(mid);

    if (fMid * fUpper <= 0) {
      lower = upper;
      fLower = fUpper;
    } else {
      fLower /= 2;
    }

    upper = mid;
    fUpper = fMid;
  }

  return Math.exp(upper / 2);
}

/** An empty outcome list is treated as an inactive rating period. */
export function updateRating(
  player: Rating,
  outcomes: readonly RatedOutcome[],
  system: GlickoSystem = DEFAULT_SYSTEM,
): Rating {
  if (outcomes.length === 0) {
    return skippedPeriod(player, system);
  }

  const { mu, phi, sigma } = toInternal(player);

  let variance = 0;
  let difference = 0;

  for (const { opponent, score } of outcomes) {
    const other = toInternal(opponent);
    const gOther = g(other.phi);
    const e = expected(mu, other.mu, other.phi);

    variance += gOther * gOther * e * (1 - e);
    difference += gOther * (score - e);
  }

  const v = 1 / variance;
  const delta = v * difference;

  const newSigma = solveVolatility(phi, sigma, v, delta, system.tau);

  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * difference;

  return fromInternal({ mu: newMu, phi: newPhi, sigma: newSigma });
}

/** An inactive period leaves the estimate fixed and widens its deviation. */
export function skippedPeriod(player: Rating, system: GlickoSystem = DEFAULT_SYSTEM): Rating {
  void system;
  const { mu, phi, sigma } = toInternal(player);

  return fromInternal({ mu, phi: Math.sqrt(phi * phi + sigma * sigma), sigma });
}
