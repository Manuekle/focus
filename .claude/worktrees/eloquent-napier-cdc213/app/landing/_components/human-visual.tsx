import Image from "next/image";
import styles from "./human-visual.module.css";

const SCENES = {
  care: { src: "/images/oruka-customer-care.webp", width: 1672, height: 941 },
  reservation: { src: "/images/oruka-reservation.webp", width: 941, height: 1672 },
  team: { src: "/images/oruka-team.webp", width: 1672, height: 941 },
} as const;

/**
 * Human scenes support the adjacent copy; the product demos remain separate.
 *
 * Every scene is a cutout on a transparent canvas that the source crops at
 * the bottom (mid-thigh, through a counter, through a table). No card: the
 * people stand on the page in a pool of light — which is what gives a black
 * suit an outline on the dark surface — and the crop goes out of focus and
 * out of opacity instead of ending at an edge.
 */
export function HumanVisual({
  scene,
  eager = false,
}: {
  readonly scene: keyof typeof SCENES;
  readonly eager?: boolean;
}) {
  const image = SCENES[scene];
  const portrait = image.height > image.width;

  return (
    <div aria-hidden="true" className={styles.frame} data-shape={portrait ? "portrait" : "landscape"}>
      <span className={styles.halo} />
      <div className={styles.cutout}>
        {/* The same file twice: sharp above, blurred below, crossfaded. A
            backdrop blur would sample the page behind the cutout as well and
            print a soft rectangle around its foot; blurring the cutout itself
            only ever softens the figure. */}
        {(["sharp", "soft"] as const).map((layer) => (
          <Image
            alt=""
            className={styles.image}
            data-layer={layer}
            fetchPriority={eager ? "high" : "auto"}
            height={image.height}
            key={layer}
            loading={eager ? "eager" : "lazy"}
            sizes={portrait
              ? "(max-width: 767px) 13rem, 15.5rem"
              : "(max-width: 767px) calc(100vw - 3rem), (max-width: 1199px) 45vw, 504px"}
            src={image.src}
            width={image.width}
          />
        ))}
      </div>
    </div>
  );
}
