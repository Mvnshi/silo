/**
 * The free AI allowance — a metered taste of the paid layer.
 *
 * ## Why this exists
 *
 * Silo's free tier is deliberately the entire habit loop: capture, link
 * extraction, stacks, search, the calendar, the map, and every resurfacing
 * mechanic. Premium buys the three Gemini-backed extras — screenshot analysis,
 * the assistant, and schedule suggestions.
 *
 * Hard-gating those three from the very first tap puts the upgrade ask at the
 * moment of *curiosity*, before the feature has ever visibly worked. Metering
 * them moves the ask to the moment of *demonstrated value*: the user has
 * watched Silo title ten screenshots correctly and then is asked to keep it.
 * That is the whole difference between an offer and a wall, and it is the
 * mechanism behind "earn the ask".
 *
 * ## The counter
 *
 * One shared lifetime pool across all three tasks. Shared because "10 free AI
 * actions" is a sentence a user can hold in their head, and three separate
 * budgets is not. Lifetime because a monthly reset teaches people to wait out
 * the gate rather than decide at it.
 *
 * ## Invariants
 *
 * - The counter only ever moves for a NON-premium user on a metered task. A
 *   subscriber never spends from it, so a lapse leaves whatever was left.
 * - `extract` is never metered — it is what turns a pasted link into a titled,
 *   playable save, and a free tier where saving is degraded is not a free tier.
 * - Consumption is recorded only after the call is known to have been allowed;
 *   a failed network round-trip must not cost the user an action.
 * - Reads are cheap and synchronous after the first hydrate, because
 *   `lib/api.ts` decides whether a call is even permitted before making it and
 *   cannot await storage on that path.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALLOWANCE_WARN_AT, FREE_AI_ACTIONS } from './config';

const KEY = 'silo:aiAllowance:v1';

/** Tasks that draw from the free allowance. Mirrors `METERED_TASKS` in api.ts. */
export type MeteredTask = 'classify_image' | 'assistant' | 'suggest_schedule';

/**
 * Actions spent so far, readable synchronously.
 *
 * Hydrated once at startup by `hydrateAllowance()`. Before that it reads 0,
 * which errs toward letting a call through — the failure mode of a cold cache
 * should be one extra free action, never a wrongly-closed gate on a user who
 * has spent nothing.
 */
let spent = 0;
let hydrated = false;

/** How many free AI actions have been used. */
export function actionsSpent(): number {
  return spent;
}

/** How many remain. Never negative. */
export function actionsRemaining(): number {
  return Math.max(0, FREE_AI_ACTIONS - spent);
}

/** True while a non-premium user still has free actions to spend. */
export function hasFreeAction(): boolean {
  return actionsRemaining() > 0;
}

/** True once the count is low enough to be worth telling the user about. */
export function shouldWarn(): boolean {
  const left = actionsRemaining();
  return left > 0 && left <= ALLOWANCE_WARN_AT;
}

/**
 * "3 free AI actions left" — the one string every surface uses, so the phrasing
 * can never drift between capture, screenshots and Settings.
 */
export function describeRemaining(): string {
  const left = actionsRemaining();
  if (left <= 0) return 'No free AI actions left';
  return `${left} free AI ${left === 1 ? 'action' : 'actions'} left`;
}

/** Load the persisted count. Safe to call more than once; only the first reads. */
export async function hydrateAllowance(): Promise<number> {
  if (hydrated) return spent;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    spent = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    // A failed read costs the user nothing; treat it as "spent nothing".
    spent = 0;
  }
  hydrated = true;
  return spent;
}

/**
 * Record one consumed action.
 *
 * Called by `lib/api.ts` only after a metered call has been allowed through,
 * so a request the gate refused — or one that never left the device — is free.
 */
export async function consumeAction(): Promise<number> {
  spent = Math.min(spent + 1, FREE_AI_ACTIONS);
  try {
    await AsyncStorage.setItem(KEY, String(spent));
  } catch {
    // In-memory count still holds for this session; worst case the user gets
    // the allowance again next launch, which is the forgiving direction.
  }
  return spent;
}

/**
 * Reset the pool. Used by the dev-only reset in Settings and by the first-run
 * verification harness — never on a normal user path, since the allowance is
 * lifetime by design.
 */
export async function resetAllowance(): Promise<void> {
  spent = 0;
  hydrated = true;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
