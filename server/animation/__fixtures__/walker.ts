import sharp from "sharp";
import { WALK_PHASES, type WalkPhase } from "../../../shared/flipbook";

// Deterministic, rights-free test drawings: a side-view walker whose legs and
// arms really change per phase, drawn from SVG. Scale and offset vary on
// purpose, the way separate Muse Image generations do.

type Leg = { readonly footX: number; readonly lift: number; readonly kneeForward: number };
type Pose = { readonly lead: Leg; readonly trail: Leg; readonly bob: number; readonly armSwing: number };

const HALF: Record<"contact" | "down" | "passing" | "up", Pose> = {
  contact: { lead: { footX: 230, lift: 0, kneeForward: 10 }, trail: { footX: -210, lift: 0, kneeForward: -10 }, bob: 10, armSwing: 1 },
  down: { lead: { footX: 120, lift: 0, kneeForward: 70 }, trail: { footX: -240, lift: 25, kneeForward: -30 }, bob: 40, armSwing: 0.8 },
  passing: { lead: { footX: 0, lift: 0, kneeForward: 0 }, trail: { footX: 20, lift: 130, kneeForward: 90 }, bob: 0, armSwing: 0.1 },
  up: { lead: { footX: -160, lift: 12, kneeForward: -20 }, trail: { footX: 170, lift: 45, kneeForward: 60 }, bob: -18, armSwing: -0.6 },
};

export function walkerPose(phase: WalkPhase): { pose: Pose; leftLeads: boolean } {
  const [side, stage] = phase.split("_") as ["left" | "right", keyof typeof HALF];
  return { pose: HALF[stage], leftLeads: side === "left" };
}

export type WalkerOptions = {
  readonly scale?: number;
  readonly offsetX?: number;
  readonly width?: number;
  readonly height?: number;
  readonly background?: string | null;
  readonly shirt?: string;
  /** Draw both legs at the same spot: a "contact" with no stride. */
  readonly feetTogether?: boolean;
};

/** One drawing, in character units: head top at y=0, ground at y=1000, facing right (+x). */
export function walkerSvg(phase: WalkPhase, options: WalkerOptions = {}): string {
  const width = options.width ?? 1024;
  const height = options.height ?? 1536;
  const scale = options.scale ?? 1;
  const { pose, leftLeads } = walkerPose(phase);
  const ox = width / 2 + (options.offsetX ?? 0);
  const groundY = height - 120;
  const unit = (units: number) => units * scale;
  const X = (x: number) => ox + unit(x);
  const Y = (y: number) => groundY - unit(1000 - y);
  const hip = 520 + pose.bob;
  const leg = (spec: Leg, color: string) => {
    const foot = options.feetTogether ? { ...spec, footX: 0, lift: 0 } : spec;
    const footY = 1000 - foot.lift;
    const knee = { x: (foot.footX) / 2 + foot.kneeForward, y: (hip + footY) / 2 };
    return `<polyline points="${X(0)},${Y(hip)} ${X(knee.x)},${Y(knee.y)} ${X(foot.footX)},${Y(footY - 20)}" fill="none" stroke="${color}" stroke-width="${unit(46)}" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<rect x="${X(foot.footX - 25)}" y="${Y(footY - 30)}" width="${unit(95)}" height="${unit(30)}" rx="${unit(10)}" fill="#111111"/>`;
  };
  const arm = (swing: number, color: string) =>
    `<polyline points="${X(0)},${Y(220 + pose.bob)} ${X(swing * 70)},${Y(360 + pose.bob)} ${X(swing * 150)},${Y(470 + pose.bob)}" fill="none" stroke="${color}" stroke-width="${unit(34)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  // Far limbs darker, drawn first: a real side view, not a mirrored copy.
  const far = leftLeads ? pose.trail : pose.lead;
  const near = leftLeads ? pose.lead : pose.trail;
  const background = options.background === null ? "" : `<rect width="${width}" height="${height}" fill="${options.background ?? "#ffffff"}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${background}
    ${arm(leftLeads ? -pose.armSwing : pose.armSwing, "#c98b55")}
    ${leg(far, "#2c3e50")}
    <rect x="${X(-62)}" y="${Y(190 + pose.bob)}" width="${unit(124)}" height="${unit(340)}" rx="${unit(30)}" fill="${options.shirt ?? "#2e86de"}"/>
    ${leg(near, "#34495e")}
    <circle cx="${X(10)}" cy="${Y(100 + pose.bob)}" r="${unit(78)}" fill="#f1c27d"/>
    <path d="M ${X(-70)} ${Y(90 + pose.bob)} Q ${X(0)} ${Y(-10 + pose.bob)} ${X(85)} ${Y(70 + pose.bob)} L ${X(40)} ${Y(60 + pose.bob)} Z" fill="#c0392b"/>
    <circle cx="${X(55)}" cy="${Y(95 + pose.bob)}" r="${unit(9)}" fill="#111111"/>
    ${arm(leftLeads ? pose.armSwing : -pose.armSwing, "#e0a26b")}
  </svg>`;
}

export async function walkerPng(phase: WalkPhase, options: WalkerOptions = {}): Promise<Buffer> {
  return sharp(Buffer.from(walkerSvg(phase, options))).png().toBuffer();
}

/** Eight drawings at slightly different sizes and positions, like separate generations. */
export const DRIFT = WALK_PHASES.map((phase, index) => ({ phase, scale: [1, 1.12, 0.92, 1.05, 0.97, 1.18, 0.9, 1.08][index], offsetX: [0, 40, -30, 15, -50, 25, 60, -20][index] }));
