/**
 * Sign in — optional, and it says so.
 *
 * Design decisions worth keeping:
 *
 * - **No password field.** Apple, Google, or a six-digit email code. A password
 *   would mean a reset flow, a strength meter, a breach surface and a support
 *   load — to protect a library that also exists on the device.
 * - **"Not now" is a real, visible option**, not grey micro-text. Silo works
 *   fully signed-out; a sign-in wall would be lying about that, and would put a
 *   gate in front of a product whose value is visible in ten seconds.
 * - **The value proposition is concrete**: sync + restore. Not "unlock your
 *   experience".
 * - **One glass card on a brand gradient.** The card is the only surface, so
 *   the eye has exactly one place to go.
 *
 * The screen is reachable from onboarding and from Settings, and routes back
 * wherever it came from.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import { useAuth } from '@/components/AuthProvider';
import {
  isAppleSignInAvailable,
  isAuthConfigured,
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  verifyEmailCode,
  type AuthResult,
} from '@/lib/auth';
import { celebrationHaptic } from '@/lib/haptics';
import { setOnboarded } from '@/lib/storage';
import { BRAND, DURATION, RADIUS, SHADOW, SPACE, SPRING, TYPE } from '@/lib/theme';
import { usePrefersReducedMotion } from '@/lib/motion';

type Step = 'choose' | 'email' | 'code';

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const { refresh } = useAuth();
  // `first=1` means we arrived from onboarding, so finishing marks it complete
  // and lands on the tabs rather than popping back to a screen that's gone.
  const { first } = useLocalSearchParams<{ first?: string }>();
  const fromOnboarding = first === '1';

  const [step, setStep] = useState<Step>('choose');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<null | 'apple' | 'google' | 'email' | 'code'>(null);
  const [error, setError] = useState('');
  const codeInput = useRef<TextInput>(null);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const leave = useCallback(async () => {
    if (fromOnboarding) {
      await setOnboarded();
      router.replace('/(tabs)');
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [fromOnboarding, router]);

  const succeed = useCallback(async () => {
    await refresh();
    await celebrationHaptic().catch(() => {});
    await leave();
  }, [refresh, leave]);

  /** Shared tail for every provider: empty message means the user cancelled. */
  const handle = useCallback(
    async (result: AuthResult) => {
      if (result.ok) return succeed();
      if (result.message) setError(result.message);
      return undefined;
    },
    [succeed]
  );

  async function withApple() {
    setError('');
    setBusy('apple');
    try {
      await handle(await signInWithApple());
    } finally {
      setBusy(null);
    }
  }

  async function withGoogle() {
    setError('');
    setBusy('google');
    try {
      await handle(await signInWithGoogle());
    } finally {
      setBusy(null);
    }
  }

  async function requestCode() {
    setError('');
    setBusy('email');
    try {
      const result = await sendEmailCode(email);
      if (result.ok) {
        setStep('code');
        // Focus lands after the layout settles; without the tick the keyboard
        // opens before the field exists and the first digit is dropped.
        setTimeout(() => codeInput.current?.focus(), 350);
      } else if (result.message) {
        setError(result.message);
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitCode(value: string) {
    setError('');
    setBusy('code');
    try {
      await handle(await verifyEmailCode(email, value));
    } finally {
      setBusy(null);
    }
  }

  // Six digits is the whole form — submit on the last one rather than making
  // the user reach for a button.
  function onCodeChange(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) {
      Keyboard.dismiss();
      void submitCode(digits);
    }
  }

  const configured = isAuthConfigured();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[BRAND[700], BRAND[500], '#6366f1']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Two soft orbs give the flat gradient some depth without an image. */}
      <View pointerEvents="none" style={[styles.orb, styles.orbTop]} />
      <View pointerEvents="none" style={[styles.orb, styles.orbBottom]} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + SPACE.xxl, paddingBottom: insets.bottom + SPACE.xxl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(DURATION.slow)} style={styles.hero}>
            <View style={styles.mark}>
              <Ionicons name="layers" size={30} color="#fff" />
            </View>
            <Text style={styles.title}>
              {step === 'choose' ? 'Keep your Silo\neverywhere' : 'Check your email'}
            </Text>
            <Text style={styles.subtitle}>
              {step === 'choose'
                ? 'An account syncs your saves to your other devices and brings them back if you reinstall. Everything still works without one.'
                : step === 'email'
                  ? 'We’ll send a six-digit code — no password to remember.'
                  : `We sent a code to ${email}.`}
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(reduced ? 0 : 90)
              .duration(DURATION.slow)
              .springify()
              .damping(SPRING.enter.damping)}
            style={styles.cardShadow}
          >
            <Glass variant="regular" tint="dark" radius={RADIUS.xxl} style={styles.card}>
              {!configured ? (
                <View style={styles.notice}>
                  <Ionicons name="information-circle" size={20} color="#fff" />
                  <Text style={styles.noticeText}>
                    Accounts aren’t set up in this build. Silo still works fully on this device.
                  </Text>
                </View>
              ) : step === 'choose' ? (
                <>
                  {appleAvailable && (
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                      cornerRadius={RADIUS.pill}
                      style={styles.appleButton}
                      onPress={withApple}
                    />
                  )}

                  <ProviderButton
                    icon="logo-google"
                    label="Continue with Google"
                    busy={busy === 'google'}
                    onPress={withGoogle}
                  />
                  <ProviderButton
                    icon="mail-outline"
                    label="Continue with email"
                    busy={false}
                    onPress={() => {
                      setError('');
                      setStep('email');
                    }}
                  />
                </>
              ) : step === 'email' ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType="go"
                    autoFocus
                    onSubmitEditing={requestCode}
                    accessibilityLabel="Email address"
                  />
                  <PrimaryButton
                    label="Send me a code"
                    busy={busy === 'email'}
                    disabled={email.trim().length < 5}
                    onPress={requestCode}
                  />
                </>
              ) : (
                <>
                  <TextInput
                    ref={codeInput}
                    style={[styles.input, styles.codeInput]}
                    value={code}
                    onChangeText={onCodeChange}
                    placeholder="000000"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    maxLength={6}
                    accessibilityLabel="Six-digit code"
                  />
                  {busy === 'code' ? (
                    <ActivityIndicator color="#fff" style={{ marginTop: SPACE.base }} />
                  ) : (
                    <PressableScale
                      haptic="light"
                      scaleTo={0.96}
                      onPress={requestCode}
                      style={styles.textButton}
                      accessibilityLabel="Send a new code"
                    >
                      <Text style={styles.textButtonLabel}>Send a new code</Text>
                    </PressableScale>
                  )}
                </>
              )}

              {!!error && (
                <Animated.View entering={FadeIn.duration(DURATION.fast)} style={styles.error}>
                  <Ionicons name="alert-circle" size={16} color="#fecaca" />
                  <Text style={styles.errorText}>{error}</Text>
                </Animated.View>
              )}
            </Glass>
          </Animated.View>

          <Animated.View entering={FadeIn.delay(reduced ? 0 : 220)} style={styles.footer}>
            {step === 'choose' ? (
              <PressableScale
                haptic="light"
                scaleTo={0.96}
                onPress={leave}
                accessibilityLabel={fromOnboarding ? 'Skip for now' : 'Close'}
              >
                <Text style={styles.footerLink}>
                  {fromOnboarding ? 'Not now — just use it on this device' : 'Close'}
                </Text>
              </PressableScale>
            ) : (
              <PressableScale
                haptic="light"
                scaleTo={0.96}
                onPress={() => {
                  setError('');
                  setCode('');
                  setStep(step === 'code' ? 'email' : 'choose');
                }}
                accessibilityLabel="Back"
              >
                <Text style={styles.footerLink}>Back</Text>
              </PressableScale>
            )}
            <Text style={styles.legal}>
              Your saves stay on your device. An account only stores your email and an id.
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function ProviderButton({
  icon,
  label,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic="medium"
      scaleTo={0.97}
      onPress={onPress}
      disabled={busy}
      style={styles.provider}
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <Ionicons name={icon} size={20} color="#fff" />
          <Text style={styles.providerLabel}>{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

function PrimaryButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic="medium"
      scaleTo={0.97}
      onPress={onPress}
      disabled={busy || disabled}
      style={[styles.primary, (busy || disabled) && styles.primaryDisabled]}
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator color={BRAND[700]} />
      ) : (
        <Text style={styles.primaryLabel}>{label}</Text>
      )}
    </PressableScale>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND[700] },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACE.xl,
  },

  orb: {
    position: 'absolute',
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  orbTop: { width: 320, height: 320, top: -110, right: -120 },
  orbBottom: { width: 260, height: 260, bottom: -80, left: -90 },

  hero: { alignItems: 'center', marginBottom: SPACE.xxl },
  mark: {
    width: 62,
    height: 62,
    borderRadius: RADIUS.xl,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.lg,
  },
  title: {
    ...TYPE.display,
    color: '#fff',
    textAlign: 'center',
  },
  subtitle: {
    ...TYPE.callout,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
    marginTop: SPACE.md,
    paddingHorizontal: SPACE.sm,
  },

  // The glass can't cast a shadow from inside its own clipped bounds, so the
  // lift lives on the wrapper.
  cardShadow: { ...SHADOW.floating },
  card: { padding: SPACE.lg, gap: SPACE.md },

  appleButton: { height: 52, width: '100%' },

  provider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.md,
    height: 52,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  providerLabel: { ...TYPE.bodyStrong, color: '#fff' },

  input: {
    ...TYPE.body,
    color: '#fff',
    height: 52,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.lg,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  codeInput: {
    ...TYPE.title2,
    color: '#fff',
    textAlign: 'center',
    // After the TYPE spread, so it isn't overwritten by the step's own tracking.
    letterSpacing: 10,
  },

  primary: {
    height: 52,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryDisabled: { opacity: 0.5 },
  primaryLabel: { ...TYPE.bodyStrong, color: BRAND[700] },

  textButton: { alignSelf: 'center', paddingVertical: SPACE.sm },
  textButtonLabel: { ...TYPE.subhead, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },

  notice: { flexDirection: 'row', gap: SPACE.md, alignItems: 'flex-start' },
  noticeText: { ...TYPE.subhead, fontWeight: '400', color: 'rgba(255,255,255,0.9)', flex: 1 },

  error: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xs },
  errorText: { ...TYPE.footnote, color: '#fecaca', flex: 1 },

  footer: { alignItems: 'center', marginTop: SPACE.xl, gap: SPACE.md },
  footerLink: { ...TYPE.callout, fontWeight: '700', color: '#fff' },
  legal: {
    ...TYPE.caption,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    paddingHorizontal: SPACE.base,
  },
});
