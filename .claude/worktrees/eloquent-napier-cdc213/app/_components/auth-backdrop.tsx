"use client";

import styles from "@/app/landing/_components/editorial.module.css";
import { Grain } from "@/app/landing/_components/grain";

/**
 * The backdrop behind every auth screen: sign-in, the two password screens and
 * onboarding.
 *
 * It existed as two lines of markup copied into four pages — `.auth-glow` and
 * `.auth-grid` — which is exactly how four screens that are meant to be the
 * same screen stop being it. Now it is one component, and the reason it became
 * one is that it gained a third layer.
 *
 * The third layer is the beam. The glow behind these cards is the same gesture
 * the landing's hero opened with before the rig: a soft ellipse, light from
 * nowhere. On the public surface that question is now answered everywhere else
 * — the hero, the four `PageHeader` pages, the closing block — and an auth
 * screen is the one place a visitor arrives at *after* being convinced. It
 * should not be the one page where the lamp goes out.
 *
 * Centred, unlike the marketing beams, because the composition is: a card in
 * the middle of the viewport, and a beam aimed off to one side of a centred
 * object is the arrangement that reads as a mistake rather than as a choice.
 *
 * `top-0` on a `<main>` that clips, so the cone has no upper edge to be cut
 * on; its mask fades in over the first sixth regardless, which is what makes
 * the light arrive rather than switch on.
 */
export function AuthBackdrop() {
  return (
    <>
      <div aria-hidden="true" className="auth-glow" />
      <div aria-hidden="true" className="auth-grid" />
      <div aria-hidden="true" className={styles.authAtmosphere}>
        <div className={styles.heroLight} />
        <Grain variant="hero" />
      </div>
    </>
  );
}
