/**
 * Degradation-contract verification — `lib/auth.ts` and `lib/billing.ts`.
 *
 * Both features are documented as OPTIONAL: with their env vars blank the app
 * must behave exactly as it did before they existed — no account surface, no
 * paywall, and every premium gate open. That promise is what makes a fresh
 * clone, a self-hosted deploy and CI usable, and it is very easy to break by
 * accident, because the broken state only shows up in a build that has the
 * env vars *missing* — which is never the build you are testing by hand.
 *
 * The subtle case this pins down: **configured to sell, but unable to.** When a
 * RevenueCat key is present and the native module is not (Expo Go, or a dev
 * client built before the dependency landed), premium must stay LOCKED. Opening
 * the gate there would hand the paid tier to anyone running a dev build.
 *
 * Run:  node scripts/verify-degradation.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';

// realpath: on macOS `tmpdir()` is /var/... which Node resolves to /private/var/...
// when it caches a module. Without this the cache-busting prefix never matches
// and every reload silently returns the first module instance.
const out = realpathSync(mkdtempSync(join(tmpdir(), 'silo-degradation-')));
try {
  execFileSync(
    'npx',
    ['tsc', 'lib/billing.ts', 'lib/config.ts', '--outDir', out, '--rootDir', '.',
     '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', '--strict', '--esModuleInterop'],
    { stdio: 'inherit' }
  );
} catch {
  console.error('tsc failed — the billing module does not compile in isolation.');
  process.exit(1);
}

/**
 * React Native and AsyncStorage cannot load outside a RN runtime, and the
 * RevenueCat native module is absent by definition here — which is exactly the
 * environment under test. Stub the first two; let the third fail naturally.
 */
const store = new Map();
const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (request === 'react-native') return { Platform: { OS: 'ios' } };
  if (request === '@react-native-async-storage/async-storage') {
    const api = {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => void store.set(k, v),
      removeItem: async (k) => void store.delete(k),
    };
    return { __esModule: true, default: api, ...api };
  }
  return originalLoad.call(this, request, ...rest);
};

const requireCjs = createRequire(import.meta.url);
const BILLING = join(out, 'lib/billing.js');
const CONFIG = requireCjs(join(out, 'lib/config.js'));

/** Load billing fresh under a given env, since it reads env at module scope. */
function loadBilling(env) {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  Object.assign(process.env, env);
  for (const key of Object.keys(requireCjs.cache)) {
    if (key.startsWith(out)) delete requireCjs.cache[key];
  }
  store.clear();
  return requireCjs(BILLING);
}

let pass = 0;
const failures = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}\n        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`); }
}

/* ---- Billing unconfigured: every gate opens ------------------------------ */
{
  const B = loadBilling({});
  check('unconfigured: isBillingConfigured is false', B.isBillingConfigured(), false);
  check('unconfigured: isBillingAvailable is false', B.isBillingAvailable(), false);
  check('unconfigured: isPremium is TRUE (the gate opens)', B.isPremium(), true);
  check('unconfigured: entitlement is active', B.cachedEntitlement().active, true);
  const e = await B.initBilling(null);
  check('unconfigured: initBilling resolves open without touching a store', e.active, true);
  check('unconfigured: still premium after init', B.isPremium(), true);
  const pkgs = await B.getPackages();
  check('unconfigured: no packages to sell', pkgs.length, 0);
  const bought = await B.purchasePackage({ identifier: 'x', packageType: 'ANNUAL', product: {} });
  check('unconfigured: purchase reports unavailable, never throws', bought.ok, false);
  const restored = await B.restorePurchases();
  check('unconfigured: restore reports unavailable, never throws', restored.ok, false);
}

/* ---- Configured to sell, but the native module is missing ---------------- */
{
  const B = loadBilling({ EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_test_key' });
  check('configured: isBillingConfigured is true', B.isBillingConfigured(), true);
  check('configured but no native module: isBillingAvailable is false', B.isBillingAvailable(), false);
  const e = await B.initBilling(null);
  check('configured but unusable: premium stays LOCKED', e.active, false);
  check('configured but unusable: isPremium is false', B.isPremium(), false);
  const bought = await B.purchasePackage({ identifier: 'x', packageType: 'ANNUAL', product: {} });
  check('configured but unusable: purchase fails cleanly', bought.ok, false);
  check('configured but unusable: and says why', bought.message.length > 0, true);
}

/* ---- Dev fixtures must be inert outside a dev build ----------------------
 *
 * `lib/billingFixtures.ts` can serve a whole fake store — packages, trial
 * eligibility, win-back offers and any entitlement shape — so that the funnel
 * can be built and looked at without a RevenueCat account. It is guarded twice:
 * by `__DEV__`, and by an env var that is absent by default. This process is
 * not a dev build, so every one of those functions must answer "nothing",
 * INCLUDING with the env var set — which is the case that matters, because it
 * is the one a leaked `.env` would produce.
 * ------------------------------------------------------------------------- */
{
  const FIXTURES = join(out, 'lib/billingFixtures.js');
  const loadFixtures = (env) => {
    delete process.env.EXPO_PUBLIC_BILLING_FIXTURE;
    Object.assign(process.env, env);
    for (const key of Object.keys(requireCjs.cache)) {
      if (key.startsWith(out)) delete requireCjs.cache[key];
    }
    return requireCjs(FIXTURES);
  };

  const F = loadFixtures({});
  check('fixtures: off with no env var', F.fixturesEnabled(), false);
  check('fixtures: no state selected', F.fixtureState(), null);

  const Fon = loadFixtures({ EXPO_PUBLIC_BILLING_FIXTURE: 'cancelled' });
  check('fixtures: STILL off outside a dev build, even with the var set',
    Fon.fixturesEnabled(), false);
  check('fixtures: serve no entitlement outside a dev build',
    Fon.fixtureEntitlement(), null);
  check('fixtures: serve no win-back offer outside a dev build',
    Fon.fixtureOffer(), null);
  check('fixtures: claim no trial eligibility outside a dev build',
    Fon.fixtureIntroEligible(), false);
  check('fixtures: report no subscription history outside a dev build',
    Fon.fixtureHistory().everSubscribed, false);

  // And the seam that matters most: billing must not report itself sellable.
  const B = loadBilling({ EXPO_PUBLIC_BILLING_FIXTURE: 'subscribed' });
  check('fixtures: a fixture var alone never makes a build sellable',
    B.isBillingConfigured(), false);
  check('fixtures: a fixture var alone never grants premium via fixtures',
    B.cachedEntitlement().productId, null);
  delete process.env.EXPO_PUBLIC_BILLING_FIXTURE;
}

/* ---- The free / metered / premium line ---------------------------------
 *
 * Read out of lib/api.ts rather than hand-mirrored, so the sets cannot drift
 * from the real gate without this failing. The previous version duplicated the
 * literal here, which meant moving the line in api.ts left a verifier happily
 * asserting the old contract.
 * ------------------------------------------------------------------------- */
{
  const api = readFileSync('lib/api.ts', 'utf8');
  const setLiteral = (name) => {
    const m = api.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
    if (!m) return null;
    return new Set(m[1].match(/'([^']+)'/g)?.map((q) => q.slice(1, -1)) ?? []);
  };

  const FREE = setLiteral('FREE_TASKS');
  const METERED = setLiteral('METERED_TASKS');
  check('lib/api.ts still declares FREE_TASKS', FREE !== null, true);
  check('lib/api.ts still declares METERED_TASKS', METERED !== null, true);

  // Extraction must never be gated or metered: it is what turns a pasted link
  // into a titled, playable save, and a free tier where saving is degraded is
  // not a free tier anyone stays in.
  check('extract is free', FREE?.has('extract'), true);
  check('extract is never metered', METERED?.has('extract'), false);

  // The three Gemini-backed extras draw from the free allowance, then close.
  check('classify_image is metered, not free', FREE?.has('classify_image'), false);
  check('classify_image draws from the allowance', METERED?.has('classify_image'), true);
  check('suggest_schedule is metered, not free', FREE?.has('suggest_schedule'), false);
  check('suggest_schedule draws from the allowance', METERED?.has('suggest_schedule'), true);
  check('assistant is metered, not free', FREE?.has('assistant'), false);
  check('assistant draws from the allowance', METERED?.has('assistant'), true);

  // A task in neither set is hard-gated. That is the safe default: a new Gemini
  // task must be opted IN to the free tier, never fall into it by omission.
  check('a task in neither set is premium by default',
    !FREE?.has('some_future_task') && !METERED?.has('some_future_task'), true);

  // The allowance is a business dial, not a correctness one — but zero would
  // silently restore a hard gate on the first tap, so it is worth stating.
  check('the free allowance is a positive number', CONFIG.FREE_AI_ACTIONS > 0, true);
  check('the warning threshold is inside the allowance',
    CONFIG.ALLOWANCE_WARN_AT > 0 && CONFIG.ALLOWANCE_WARN_AT < CONFIG.FREE_AI_ACTIONS, true);
}

Module._load = originalLoad;
rmSync(out, { recursive: true, force: true });

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('failed:\n  ' + failures.join('\n  ')); process.exit(1); }
