/**
 * Funnel verification — the retention state machine and the free allowance.
 *
 * ## Why this exists
 *
 * Real purchases cannot be exercised in a simulator: they need a RevenueCat
 * project, App Store Connect products, an EAS build and a sandbox tester. But
 * almost none of the *decisions* in this funnel are about purchasing. They are
 * about classifying an entitlement — which is plain data — and every one of
 * them has a wrong answer that is expensive:
 *
 *   - telling a paying customer their payment failed
 *   - telling someone who cancelled that their subscription renews
 *   - offering a trial to an Apple ID that has already used one
 *   - showing a discount percentage no real product backs
 *   - charging a free action against a request that never came back
 *
 * So the classification, the copy that hangs off it, and the allowance
 * arithmetic are all driven here from synthetic entitlements. What remains
 * unproven after this run is exactly the part that needs a real store, and
 * nothing else.
 *
 * Run:  node scripts/verify-funnel.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';

// realpath: on macOS `tmpdir()` is /var/... which Node resolves to /private/var/...
// when it caches a module. Without this the cache-busting prefix never matches.
const out = realpathSync(mkdtempSync(join(tmpdir(), 'silo-funnel-')));
try {
  execFileSync(
    'npx',
    ['tsc', 'lib/retention.ts', 'lib/allowance.ts', 'lib/billing.ts', 'lib/config.ts',
     '--outDir', out, '--rootDir', '.',
     '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', '--strict', '--esModuleInterop'],
    { stdio: 'inherit' }
  );
} catch {
  console.error('tsc failed — the funnel modules do not compile in isolation.');
  process.exit(1);
}

/** RN and AsyncStorage cannot load outside a RN runtime. Stub them. */
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
const R = requireCjs(join(out, 'lib/retention.js'));
const B = requireCjs(join(out, 'lib/billing.js'));
const CONFIG = requireCjs(join(out, 'lib/config.js'));

let pass = 0;
const failures = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}\n        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`); }
}

const NOW = new Date('2026-09-01T12:00:00Z');
const IN_3_DAYS = '2026-09-04T12:00:00Z';
const LAST_MONTH = '2026-08-01T12:00:00Z';

/** An entitlement with every field defaulted, so each test states only its point. */
function ent(overrides = {}) {
  return {
    active: true,
    willRenew: true,
    expiresAt: IN_3_DAYS,
    productId: 'silo_premium_yearly',
    inTrial: false,
    managementUrl: null,
    billingIssueAt: null,
    unsubscribedAt: null,
    ...overrides,
  };
}
const NO_HISTORY = { everSubscribed: false, lastExpiry: null, productId: null };
const WAS_SUBSCRIBED = { everSubscribed: true, lastExpiry: LAST_MONTH, productId: 'silo_premium_yearly' };

const state = (e, h = NO_HISTORY, configured = true) =>
  R.situationFor(e, h, configured, NOW).state;

/* ---- Classification: every branch --------------------------------------- */
{
  check('unconfigured build has no subscription state at all',
    state(ent(), NO_HISTORY, false), 'open');
  check('never subscribed → none',
    state(ent({ active: false }), NO_HISTORY), 'none');
  check('paying and renewing → subscribed',
    state(ent()), 'subscribed');
  check('in trial, will convert → trialing',
    state(ent({ inTrial: true })), 'trialing');
  check('in trial, renewal off → trialCancelled',
    state(ent({ inTrial: true, willRenew: false })), 'trialCancelled');
  check('paid, renewal off, still inside the period → cancelled',
    state(ent({ willRenew: false })), 'cancelled');
  check('expired, but this install once paid → lapsed',
    state(ent({ active: false }), WAS_SUBSCRIBED), 'lapsed');
  check('failed charge outranks everything else → billingIssue',
    state(ent({ billingIssueAt: '2026-08-30T00:00:00Z' })), 'billingIssue');
  check('a failed charge during a trial is still billingIssue',
    state(ent({ inTrial: true, billingIssueAt: '2026-08-30T00:00:00Z' })), 'billingIssue');
}

/* ---- What each state is allowed to do ----------------------------------- */
{
  const cancelled = R.situationFor(ent({ willRenew: false }), NO_HISTORY, true, NOW);
  check('cancelled is urgent enough to interrupt', cancelled.urgent, true);
  check('cancelled counts the days left', cancelled.daysLeft, 3);
  check('cancelled asks for the retention offering', cancelled.offering, CONFIG.OFFERING_RETENTION);
  check('cancelled opens the retention paywall', cancelled.paywallContext, 'retention');

  const lapsed = R.situationFor(ent({ active: false }), WAS_SUBSCRIBED, true, NOW);
  check('lapsed asks for the win-back offering', lapsed.offering, CONFIG.OFFERING_WINBACK);
  check('lapsed opens the win-back paywall', lapsed.paywallContext, 'winback');
  check('lapsed carries the last expiry we saw', lapsed.endsAt, LAST_MONTH);

  const happy = R.situationFor(ent(), NO_HISTORY, true, NOW);
  check('a renewing subscriber is never interrupted', happy.urgent, false);
  const trial = R.situationFor(ent({ inTrial: true }), NO_HISTORY, true, NOW);
  check('a converting trial is never interrupted', trial.urgent, false);
  const open = R.situationFor(ent(), NO_HISTORY, false, NOW);
  check('an unconfigured build is never interrupted', open.urgent, false);
}

/* ---- daysUntil ---------------------------------------------------------- */
{
  check('daysUntil counts whole days', R.daysUntil(IN_3_DAYS, NOW), 3);
  check('daysUntil floors at zero rather than going negative',
    R.daysUntil(LAST_MONTH, NOW), 0);
  check('daysUntil on a missing date is null', R.daysUntil(null, NOW), null);
  check('daysUntil on a bad date is null', R.daysUntil('not-a-date', NOW), null);
}

/* ---- Copy: the two sentences that generate support mail if wrong -------- */
{
  const renewing = R.retentionCopy(R.situationFor(ent(), NO_HISTORY, true, NOW));
  check('a renewing subscription says "Renews"', /^Renews /.test(renewing.status), true);
  check('a renewing subscription never says "Ends"', /Ends/.test(renewing.status), false);

  const cancelled = R.retentionCopy(R.situationFor(ent({ willRenew: false }), NO_HISTORY, true, NOW));
  check('a cancelled subscription says "Ends"', /^Ends /.test(cancelled.status), true);
  check('a cancelled subscription never says "Renews"', /Renews/.test(cancelled.status), false);

  // The documented Settings form is the short one ("Ends 4 Sep" / "Ends Sep 4"
  // depending on locale). Assert the FORM, not one locale's ordering — the long
  // form ("September 4") belongs in banner prose, not in a settings row.
  const shortDate = new Date(IN_3_DAYS).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  check('the status line uses the short date form', cancelled.status, `Ends ${shortDate}`);
  check('the banner body uses the long date form',
    cancelled.body.includes(
      new Date(IN_3_DAYS).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    ), true);

  const lifetime = R.retentionCopy(
    R.situationFor(ent({ willRenew: false, expiresAt: null }), NO_HISTORY, true, NOW)
  );
  check('an open-ended entitlement is "Active", never "Ends soon"', lifetime.status, 'Active');

  const trial = R.retentionCopy(R.situationFor(ent({ inTrial: true }), NO_HISTORY, true, NOW));
  check('a converting trial names the first charge',
    /first charge/.test(trial.status), true);

  const billing = R.retentionCopy(
    R.situationFor(ent({ billingIssueAt: '2026-08-30T00:00:00Z' }), NO_HISTORY, true, NOW)
  );
  check('a billing issue leads with the payment method',
    /payment method/.test(billing.body), true);
  check('a billing issue does not claim the user cancelled',
    /cancel/i.test(billing.body), false);
}

/* ---- Paywall copy: every context is distinct and non-empty -------------- */
{
  const contexts = ['default', 'onboarding', 'screenshot', 'assistant', 'schedule',
                    'allowance', 'retention', 'winback'];
  const titles = contexts.map((ctx) => R.paywallHeadline(ctx).title);
  check('every paywall context has its own headline',
    new Set(titles).size, contexts.length);
  check('no paywall headline is empty',
    titles.every((t) => t.length > 0), true);
  check('an unknown context falls back rather than rendering blank',
    R.paywallHeadline('nonsense-context').title.length > 0, true);
}

/* ---- Prices: never invent one ------------------------------------------- */
{
  const pkg = (type, price) => ({
    identifier: type,
    packageType: type,
    product: { identifier: `id_${type}`, price, priceString: `$${price}`, title: '', description: '' },
  });

  check('the saving is computed from real numeric prices',
    B.annualSavingPercent(pkg('ANNUAL', 39.99), pkg('MONTHLY', 6.99)), 52);
  check('no monthly plan → no saving claim',
    B.annualSavingPercent(pkg('ANNUAL', 39.99), undefined), null);
  check('no annual plan → no saving claim',
    B.annualSavingPercent(undefined, pkg('MONTHLY', 6.99)), null);
  check('a zero price is treated as missing, not as free',
    B.annualSavingPercent(pkg('ANNUAL', 0), pkg('MONTHLY', 6.99)), null);
  check('an annual plan that saves nothing shows no badge',
    B.annualSavingPercent(pkg('ANNUAL', 90), pkg('MONTHLY', 6.99)), null);

  /* trialDaysFor reads the store, not the constant. */
  const withIntro = (unit, units, price = 0) => ({
    identifier: 'a', packageType: 'ANNUAL',
    product: {
      identifier: 'id', price: 39.99, priceString: '$39.99', title: '', description: '',
      introPrice: { price, priceString: '$0.00', periodUnit: unit, periodNumberOfUnits: units, cycles: 1 },
    },
  });
  check('a 7-day intro reads as 7 days', B.trialDaysFor(withIntro('DAY', 7)), 7);
  check('a 1-week intro reads as 7 days', B.trialDaysFor(withIntro('WEEK', 1)), 7);
  check('a 1-month intro reads as 30 days', B.trialDaysFor(withIntro('MONTH', 1)), 30);
  check('a PAID intro offer is not a free trial', B.trialDaysFor(withIntro('DAY', 7, 4.99)), null);
  check('no intro offer → no trial promised', B.trialDaysFor(pkg('ANNUAL', 39.99)), null);
  check('no package at all → no trial promised', B.trialDaysFor(undefined), null);
}

/* ---- Offers degrade to nothing, never to a placeholder ------------------ */
{
  // Billing is unconfigured in this process, so every store call must answer
  // "no offer" rather than throwing or inventing one.
  check('unconfigured: no named offering exists', await B.hasOffering('winback'), false);
  check('unconfigured: no packages in a named offering', (await B.getPackages('winback')).length, 0);
  check('unconfigured: intro eligibility is unknown, not "yes"',
    await B.introEligibility('id_annual'), null);
  check('unconfigured: no discount is resolved',
    await B.bestOfferFor({ identifier: 'a', packageType: 'ANNUAL', product: { discounts: [] } }), null);
  const bought = await B.purchaseWithOffer(
    { identifier: 'a', packageType: 'ANNUAL', product: {} },
    { kind: 'winback', priceString: '$1', periodUnit: 'MONTH', periodNumberOfUnits: 1, cycles: 1, payload: {} }
  );
  check('unconfigured: a discounted purchase fails cleanly, never throws', bought.ok, false);
}

/* ---- The free allowance ------------------------------------------------- */
{
  const A = requireCjs(join(out, 'lib/allowance.js'));
  const TOTAL = CONFIG.FREE_AI_ACTIONS;

  await A.resetAllowance();
  check('a new user has the full allowance', A.actionsRemaining(), TOTAL);
  check('a new user may make a metered call', A.hasFreeAction(), true);
  check('a full allowance is not worth warning about', A.shouldWarn(), false);

  for (let i = 0; i < TOTAL - CONFIG.ALLOWANCE_WARN_AT; i++) await A.consumeAction();
  check('the count follows what was spent', A.actionsRemaining(), CONFIG.ALLOWANCE_WARN_AT);
  check('the warning starts at the configured threshold', A.shouldWarn(), true);
  check('the remaining count reads naturally',
    A.describeRemaining(), `${CONFIG.ALLOWANCE_WARN_AT} free AI actions left`);

  for (let i = 0; i < CONFIG.ALLOWANCE_WARN_AT - 1; i++) await A.consumeAction();
  check('the last action is singular, not "1 actions"', A.describeRemaining(), '1 free AI action left');

  await A.consumeAction();
  check('an exhausted allowance blocks the next call', A.hasFreeAction(), false);
  check('an exhausted allowance reports zero', A.actionsRemaining(), 0);
  check('an exhausted allowance stops warning and states the fact',
    A.describeRemaining(), 'No free AI actions left');

  await A.consumeAction();
  check('spending past zero never goes negative', A.actionsRemaining(), 0);

  // Persistence: a fresh module instance must see the same spent count.
  for (const key of Object.keys(requireCjs.cache)) {
    if (key.startsWith(out)) delete requireCjs.cache[key];
  }
  const A2 = requireCjs(join(out, 'lib/allowance.js'));
  check('before hydrating, an unknown count errs toward letting the user through',
    A2.hasFreeAction(), true);
  await A2.hydrateAllowance();
  check('the spent count survives a restart', A2.actionsRemaining(), 0);

  await A2.resetAllowance();
  check('a reset restores the whole allowance', A2.actionsRemaining(), TOTAL);
}

Module._load = originalLoad;
rmSync(out, { recursive: true, force: true });

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('failed:\n  ' + failures.join('\n  ')); process.exit(1); }
