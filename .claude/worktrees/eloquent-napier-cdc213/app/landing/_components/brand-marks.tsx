/**
 * The channel marks, in the platforms' own colours.
 *
 * The app itself draws channels as monochrome Hugeicons glyphs, because inside
 * a working inbox a row of full-colour logos is chrome competing with the
 * message. The landing is the one place where the opposite is true: the claim
 * of the section is "the places people already write to you", and a reader
 * recognises a green WhatsApp bubble before they have finished reading the
 * word.
 *
 * Each gradient id is namespaced to its mark, and each mark is rendered once
 * per page. Two copies of the Instagram logo on one document would share a
 * single set of `instagram-mark__*` ids and the second would silently paint
 * with the first one's gradients — which is why this section is a static row
 * rather than the four-copy marquee it replaced.
 */

const SIZE_CLASS = "shrink-0";

/** Y Combinator mark supplied for the application announcement. */
export function YCombinatorMark({ size = 32 }: { readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={SIZE_CLASS}
      height={size}
      viewBox="0 0 256 256"
      width={size}
    >
      <rect fill="#FB651E" height="256" width="256" />
      <path
        d="M119.373653 144.745813 75.43296 62.431573h20.081493l25.847467 52.092587c.397655.927862.86158 1.888848 1.391787 2.882987.530207.994138.994131 2.021399 1.391786 3.081813.265104.397655.463929.762167.59648 1.093547.132552.331379.265102.629616.397654.89472 1.060415 1.325517 1.656888 2.617878 2.187095 3.87712.530207 1.259242.994131 2.419052 1.391786 3.479466 1.060415-2.25338 2.220225-4.672413 3.479467-7.257173 1.259242-2.58476 2.551602-5.268893 3.87712-8.05248l26.24512-52.092587h18.689707l-44.338347 83.308374v53.08672h-16.900267z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function MetaMark({ size = 28 }: { readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={SIZE_CLASS}
      height={(size * 171) / 256}
      preserveAspectRatio="xMidYMid"
      viewBox="0 0 256 171"
      width={size}
    >
      <defs>
        <linearGradient id="meta-mark__a" x1="13.878%" x2="89.144%" y1="55.934%" y2="58.694%">
          <stop offset="0%" stopColor="#0064E1" />
          <stop offset="40%" stopColor="#0064E1" />
          <stop offset="83%" stopColor="#0073EE" />
          <stop offset="100%" stopColor="#0082FB" />
        </linearGradient>
        <linearGradient id="meta-mark__b" x1="54.315%" x2="54.315%" y1="82.782%" y2="39.307%">
          <stop offset="0%" stopColor="#0082FB" />
          <stop offset="100%" stopColor="#0064E0" />
        </linearGradient>
      </defs>
      <path
        d="M27.651 112.136c0 9.775 2.146 17.28 4.95 21.82 3.677 5.947 9.16 8.466 14.751 8.466 7.211 0 13.808-1.79 26.52-19.372 10.185-14.092 22.186-33.874 30.26-46.275l13.675-21.01c9.499-14.591 20.493-30.811 33.1-41.806C161.196 4.985 172.298 0 183.47 0c18.758 0 36.625 10.87 50.3 31.257C248.735 53.584 256 81.707 256 110.729c0 17.253-3.4 29.93-9.187 39.946-5.591 9.686-16.488 19.363-34.818 19.363v-27.616c15.695 0 19.612-14.422 19.612-30.927 0-23.52-5.484-49.623-17.564-68.273-8.574-13.23-19.684-21.313-31.907-21.313-13.22 0-23.859 9.97-35.815 27.75-6.356 9.445-12.882 20.956-20.208 33.944l-8.066 14.289c-16.203 28.728-20.307 35.271-28.408 46.07-14.2 18.91-26.324 26.076-42.287 26.076-18.935 0-30.91-8.2-38.325-20.556C2.973 139.413 0 126.202 0 111.148l27.651.988Z"
        fill="#0081FB"
      />
      <path
        d="M21.802 33.206C34.48 13.666 52.774 0 73.757 0 85.91 0 97.99 3.597 110.605 13.897c13.798 11.261 28.505 29.805 46.853 60.368l6.58 10.967c15.881 26.459 24.917 40.07 30.205 46.49 6.802 8.243 11.565 10.7 17.752 10.7 15.695 0 19.612-14.422 19.612-30.927l24.393-.766c0 17.253-3.4 29.93-9.187 39.946-5.591 9.686-16.488 19.363-34.818 19.363-11.395 0-21.49-2.475-32.654-13.007-8.582-8.083-18.615-22.443-26.334-35.352l-22.96-38.352C118.528 64.08 107.96 49.73 101.845 43.23c-6.578-6.988-15.036-15.428-28.532-15.428-10.923 0-20.2 7.666-27.963 19.39L21.802 33.206Z"
        fill="url(#meta-mark__a)"
      />
      <path
        d="M73.312 27.802c-10.923 0-20.2 7.666-27.963 19.39-10.976 16.568-17.698 41.245-17.698 64.944 0 9.775 2.146 17.28 4.95 21.82L9.027 149.482C2.973 139.413 0 126.202 0 111.148 0 83.772 7.514 55.24 21.802 33.206 34.48 13.666 52.774 0 73.757 0l-.445 27.802Z"
        fill="url(#meta-mark__b)"
      />
    </svg>
  );
}

export function WhatsAppMark({ size = 28 }: { readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={SIZE_CLASS}
      fill="none"
      height={(size * 362) / 360}
      viewBox="0 0 360 362"
      width={size}
    >
      <path
        clipRule="evenodd"
        d="M307.546 52.566C273.709 18.684 228.706.017 180.756 0 81.951 0 1.538 80.404 1.504 179.235c-.017 31.594 8.242 62.432 23.928 89.609L0 361.736l95.024-24.925c26.179 14.285 55.659 21.805 85.655 21.814h.077c98.788 0 179.21-80.413 179.244-179.244.017-47.898-18.608-92.926-52.454-126.807v-.008Zm-126.79 275.788h-.06c-26.73-.008-52.952-7.194-75.831-20.765l-5.44-3.231-56.391 14.791 15.05-54.981-3.542-5.638c-14.912-23.721-22.793-51.139-22.776-79.286.035-82.14 66.867-148.973 149.051-148.973 39.793.017 77.198 15.53 105.328 43.695 28.131 28.157 43.61 65.596 43.593 105.398-.035 82.149-66.867 148.982-148.982 148.982v.008Zm81.719-111.577c-4.478-2.243-26.497-13.073-30.606-14.568-4.108-1.496-7.09-2.243-10.073 2.243-2.982 4.487-11.568 14.577-14.181 17.559-2.613 2.991-5.226 3.361-9.704 1.117-4.477-2.243-18.908-6.97-36.02-22.226-13.313-11.878-22.304-26.54-24.916-31.027-2.613-4.486-.275-6.91 1.959-9.136 2.011-2.011 4.478-5.234 6.721-7.847 2.244-2.613 2.983-4.486 4.478-7.469 1.496-2.991.748-5.603-.369-7.847-1.118-2.243-10.073-24.289-13.812-33.253-3.636-8.732-7.331-7.546-10.073-7.692-2.613-.13-5.595-.155-8.586-.155-2.991 0-7.839 1.118-11.947 5.604-4.108 4.486-15.677 15.324-15.677 37.361s16.047 43.344 18.29 46.335c2.243 2.991 31.585 48.225 76.51 67.632 10.684 4.615 19.029 7.374 25.535 9.437 10.727 3.412 20.49 2.931 28.208 1.779 8.604-1.289 26.498-10.838 30.228-21.298 3.73-10.46 3.73-19.433 2.613-21.298-1.117-1.865-4.108-2.991-8.586-5.234l.008-.017Z"
        fill="#25D366"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function InstagramMark({ size = 28 }: { readonly size?: number }) {
  /* The four radial gradients in the original all inherit their stops from a
     linear gradient via `xlink:href`. SVG 2's plain `href` does the same job
     and is what React passes through without a namespace attribute. */
  return (
    <svg
      aria-hidden="true"
      className={SIZE_CLASS}
      height={size}
      viewBox="0 0 264.583 264.583"
      width={size}
    >
      <defs>
        <linearGradient id="instagram-mark__a">
          <stop offset="0" stopColor="#fc0" />
          <stop offset=".124" stopColor="#fc0" />
          <stop offset=".567" stopColor="#fe4a05" />
          <stop offset=".694" stopColor="#ff0f3f" />
          <stop offset="1" stopColor="#fe0657" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="instagram-mark__b">
          <stop offset="0" stopColor="#fc0" />
          <stop offset="1" stopColor="#fc0" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="instagram-mark__c">
          <stop offset="0" stopColor="#780cff" />
          <stop offset="1" stopColor="#820bff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="instagram-mark__d">
          <stop offset="0" stopColor="#ff005f" />
          <stop offset="1" stopColor="#fc01d8" />
        </linearGradient>
        <radialGradient
          cx="199.788"
          cy="628.438"
          fx="199.788"
          fy="628.438"
          gradientTransform="matrix(-3.10797 .87652 -.6315 -2.23914 1345.65 1374.198)"
          gradientUnits="userSpaceOnUse"
          href="#instagram-mark__d"
          id="instagram-mark__e"
          r="52.352"
        />
        <radialGradient
          cx="158.429"
          cy="578.088"
          fx="158.429"
          fy="578.088"
          gradientTransform="matrix(0 -4.03418 4.28018 0 -2332.227 942.236)"
          gradientUnits="userSpaceOnUse"
          href="#instagram-mark__a"
          id="instagram-mark__f"
          r="52.352"
        />
        <radialGradient
          cx="172.615"
          cy="600.692"
          fx="172.615"
          fy="600.692"
          gradientTransform="matrix(.67441 -1.16203 1.51283 .87801 -814.366 -47.835)"
          gradientUnits="userSpaceOnUse"
          href="#instagram-mark__b"
          id="instagram-mark__g"
          r="65"
        />
        <radialGradient
          cx="144.012"
          cy="51.337"
          fx="144.012"
          fy="51.337"
          gradientTransform="matrix(-2.3989 .67549 -.23008 -.81732 464.996 -26.404)"
          gradientUnits="userSpaceOnUse"
          href="#instagram-mark__c"
          id="instagram-mark__h"
          r="67.081"
        />
      </defs>
      {["e", "f", "g", "h"].map((layer) => (
        <path
          d="M204.15 18.143c-55.23 0-71.383.057-74.523.317-11.334.943-18.387 2.728-26.07 6.554-5.922 2.942-10.592 6.351-15.201 11.13-8.394 8.716-13.481 19.439-15.323 32.184-.895 6.188-1.156 7.45-1.209 39.056-.02 10.536 0 24.4 0 42.999 0 55.2.062 71.341.326 74.476.916 11.032 2.645 17.973 6.308 25.565 7 14.533 20.37 25.443 36.12 29.514 5.453 1.404 11.476 2.178 19.208 2.544 3.277.142 36.669.244 70.081.244 33.413 0 66.826-.04 70.02-.203 8.954-.422 14.153-1.12 19.901-2.606 15.852-4.09 28.977-14.838 36.12-29.575 3.591-7.409 5.412-14.614 6.236-25.07.18-2.28.255-38.626.255-74.924 0-36.304-.082-72.583-.26-74.863-.835-10.625-2.656-17.77-6.364-25.32-3.042-6.182-6.42-10.799-11.324-15.519-8.752-8.361-19.455-13.45-32.21-15.29-6.18-.894-7.41-1.158-39.033-1.213z"
          fill={`url(#instagram-mark__${layer})`}
          key={layer}
          transform="translate(-71.816 -18.143)"
        />
      ))}
      <path
        d="M132.345 33.973c-26.716 0-30.07.117-40.563.594-10.472.48-17.62 2.136-23.876 4.567-6.47 2.51-11.958 5.87-17.426 11.335-5.472 5.464-8.834 10.948-11.354 17.412-2.44 6.252-4.1 13.397-4.57 23.858-.47 10.486-.593 13.838-.593 40.535 0 26.697.119 30.037.594 40.522.482 10.465 2.14 17.609 4.57 23.859 2.515 6.465 5.876 11.95 11.346 17.414 5.466 5.468 10.955 8.834 17.42 11.345 6.26 2.431 13.41 4.088 23.881 4.567 10.493.477 13.844.594 40.559.594 26.719 0 30.061-.117 40.555-.594 10.472-.48 17.63-2.136 23.888-4.567 6.468-2.51 11.948-5.877 17.414-11.345 5.472-5.464 8.834-10.949 11.354-17.412 2.419-6.252 4.079-13.398 4.57-23.858.472-10.486.595-13.828.595-40.525s-.123-30.047-.594-40.533c-.492-10.465-2.152-17.608-4.57-23.858-2.521-6.466-5.883-11.95-11.355-17.414-5.472-5.468-10.944-8.827-17.42-11.335-6.271-2.431-13.424-4.088-23.897-4.567-10.493-.477-13.834-.594-40.558-.594zm-8.825 17.715c2.62-.004 5.542 0 8.825 0 26.266 0 29.38.094 39.752.565 9.591.438 14.797 2.04 18.264 3.385 4.591 1.782 7.864 3.912 11.305 7.352 3.443 3.44 5.575 6.717 7.362 11.305 1.346 3.46 2.951 8.663 3.388 18.247.47 10.363.573 13.475.573 39.71 0 26.233-.102 29.346-.573 39.709-.44 9.584-2.042 14.786-3.388 18.247-1.783 4.587-3.919 7.854-7.362 11.292-3.443 3.441-6.712 5.57-11.305 7.352-3.463 1.352-8.673 2.95-18.264 3.388-10.37.47-13.486.573-39.752.573-26.268 0-29.38-.102-39.751-.573-9.592-.443-14.797-2.044-18.267-3.39-4.59-1.781-7.87-3.911-11.313-7.352-3.443-3.44-5.574-6.709-7.362-11.298-1.346-3.461-2.95-8.663-3.387-18.247-.472-10.363-.566-13.476-.566-39.726s.094-29.347.566-39.71c.438-9.584 2.04-14.786 3.387-18.25 1.783-4.588 3.919-7.865 7.362-11.305 3.443-3.441 6.722-5.57 11.313-7.357 3.468-1.351 8.675-2.949 18.267-3.389 9.075-.41 12.592-.532 30.926-.553zm61.337 16.322c-6.518 0-11.805 5.277-11.805 11.792 0 6.512 5.287 11.796 11.805 11.796 6.517 0 11.804-5.284 11.804-11.796 0-6.513-5.287-11.796-11.805-11.796zm-52.512 13.782c-27.9 0-50.519 22.603-50.519 50.482 0 27.879 22.62 50.471 50.52 50.471s50.51-22.592 50.51-50.471c0-27.879-22.613-50.482-50.513-50.482zm0 17.715c18.11 0 32.792 14.67 32.792 32.767 0 18.096-14.683 32.767-32.792 32.767-18.11 0-32.791-14.671-32.791-32.767 0-18.098 14.68-32.767 32.791-32.767z"
        fill="#fff"
      />
    </svg>
  );
}

export function LinkedInMark({ size = 24 }: { readonly size?: number }) {
  return (
    <svg aria-hidden="true" className={SIZE_CLASS} height={size} viewBox="0 0 256 256" width={size}>
      <rect fill="#0A66C2" height="256" rx="18" width="256" />
      <circle cx="56.95" cy="57.25" fill="#fff" r="22.01" />
      <path d="M37.95 95.97h37.97v122.16H37.95z" fill="#fff" />
      <path d="M218.12 218.13h-37.93v-59.4c0-14.17-.25-32.4-19.73-32.4-19.75 0-22.78 15.43-22.78 31.37v60.43H99.75V95.97h36.41v16.69h.51A39.91 39.91 0 0 1 172.6 92.93c38.45 0 45.53 25.29 45.53 58.19Z" fill="#fff" />
    </svg>
  );
}

export function YouTubeMark({ size = 28 }: { readonly size?: number }) {
  return (
    <svg aria-hidden="true" className={SIZE_CLASS} height={(size * 180) / 256} preserveAspectRatio="xMidYMid" viewBox="0 0 256 180" width={size}>
      <path fill="#FF0000" d="M250.346 28.075A32.18 32.18 0 0 0 227.69 5.418C207.824 0 127.87 0 127.87 0S47.912.164 28.046 5.582A32.18 32.18 0 0 0 5.39 28.24c-6.009 35.298-8.34 89.084.165 122.97a32.18 32.18 0 0 0 22.656 22.657c19.866 5.418 99.822 5.418 99.822 5.418s79.955 0 99.82-5.418a32.18 32.18 0 0 0 22.657-22.657c6.338-35.348 8.291-89.1-.164-123.134Z" />
      <path fill="#FFF" d="m102.421 128.06 66.328-38.418-66.328-38.418z" />
    </svg>
  );
}

export function TikTokMark({ size = 24 }: { readonly size?: number }) {
  return (
    <svg aria-hidden="true" className={SIZE_CLASS} height={size} viewBox="0 0 540 611" width={size}>
      <g transform="matrix(1,0,0,1,-207.1,-148.1)">
        <g transform="matrix(1,0,0,1,-10,148)">
          <path d="M427.2,241.1L427.2,216.7C418.9,215.5 410.6,215 402.2,214.9C300.1,214.9 217.1,297.9 217.1,400C217.1,460.4 246.6,517 296.1,551.6C265.3,518.5 247,474.2 247,425.5C246.9,325.2 327,243.2 427.2,241.1Z" fill="#25F4EE" />
        </g>
        <g transform="matrix(1,0,0,1,-10,148)">
          <path d="M431.6,510.7C477.1,510.7 514.9,473.9 516.6,428.7L516.7,26.2L589.7,25.6C588.1,17.2 587.3,8.6 587.3,0.1L486.8,0.1L486.6,403.2C485,449.8 445.9,486.2 399.4,484.6C386.7,484.2 374.3,480.9 363,474.9C378.4,496.1 403.3,510.7 431.6,510.7Z" fill="#25F4EE" />
        </g>
        <g transform="matrix(1,0,0,1,-10,148)">
          <path d="M727.3,163.1L727.3,140C700.2,140 673.7,132.1 651.1,117.3C670.7,139.8 697.2,156.6 727.3,163.1Z" fill="#25F4EE" />
        </g>
        <g transform="matrix(1,0,0,1,-10,148)">
          <path d="M651.1,117.3C628.9,91.9 616.7,59.3 616.7,25.5L589.7,25.5C596.8,63.2 619,96.4 651.1,117.3Z" fill="#FE2C55" />
        </g>
        <g transform="matrix(1,0,0,1,-10,148)">
          <path d="M402.2,315.4C355.5,315.3 317.6,353.1 317.6,399.8C317.6,431.3 335.1,460.3 363,474.8C335.7,437 344.2,384.3 381.9,356.9C396.3,346.5 413.7,340.9 431.5,340.9C440,340.9 448.4,342.2 456.5,344.8L456.5,242.2C448.2,241 439.9,240.4 431.5,240.4C430,240.4 428.6,240.5 427.1,240.5L427.1,319.4C419.1,316.8 410.7,315.4 402.2,315.4Z" fill="#FE2C55" />
        </g>
        <g transform="matrix(1,0,0,1,-10,148)">
          <path d="M727.3,162.4L727.3,240.6C677.1,240.7 628.1,224.9 587.4,195.6L587.4,400C587.4,502.1 504.3,585.1 402.3,585.1C364.3,585.1 327.3,573.4 296.2,551.5C331.1,589.2 380.2,610.6 431.6,610.6C533.7,610.6 616.7,527.6 616.7,425.5L616.7,221.1C657.5,250.4 706.4,266.2 756.6,266.1L756.6,165.5C746.8,165.5 737,164.4 727.3,162.4Z" fill="#FE2C55" />
        </g>
        <g transform="matrix(1,0,0,1,-10,148)">
          <path d="M587.4,400L587.4,195.6C628.2,224.9 677.1,240.7 727.3,240.6L727.3,162.4C697.7,156 670.9,140.2 651.1,117.3C619,96.4 596.8,63.2 589.7,25.5L516.1,25.5L516,428.7C514.4,475.3 475.3,511.7 428.7,510.1C402.5,509.2 378.3,496.2 363.1,474.9C321.7,453.3 305.7,402.2 327.3,360.9C341.9,333 370.8,315.4 402.3,315.5C410.8,315.5 419.2,316.8 427.3,319.4L427.3,240.5C327.2,242.8 246.5,324.9 246.5,425.5C246.5,472.3 264.2,517.4 296.2,551.6C327.3,573.5 364.3,585.2 402.3,585.2C504.3,585.1 587.4,502.1 587.4,400Z" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Stripe, as the user supplied it. The colour is `#533afd`, which is close to
 * but not Stripe's brand purple (`#635BFF`) — worth checking against their
 * brand kit before this goes public, since a logo redrawn slightly wrong is
 * the kind of thing a brand team notices.
 */
export function StripeMark({ size = 26 }: { readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={SIZE_CLASS}
      fill="none"
      height={size}
      viewBox="100 100 312 312"
      width={size}
    >
      <path
        clipRule="evenodd"
        d="m120 392 272-57.683V120l-272 58.357z"
        fill="#533afd"
        fillRule="evenodd"
      />
    </svg>
  );
}

/**
 * The Google G. Four radial gradients, four linear ramps and two blur filters
 * — the mark is a gradient mesh, not a flat logo, so it cannot be reduced to
 * paths without losing what makes it recognisable.
 *
 * As with the Instagram mark: one instance per page. The ids are namespaced
 * to `google-mark__*`, but two copies on one document would still collide.
 */
export function GoogleMark({ size = 26 }: { readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={SIZE_CLASS}
      height={size}
      overflow="hidden"
      viewBox="0 0 268.152 273.883"
      width={(size * 268.152) / 273.883}
    >
      <defs>
        <linearGradient id="google-mark__a">
          <stop offset="0" stopColor="#0fbc5c" />
          <stop offset="1" stopColor="#0cba65" />
        </linearGradient>
        <linearGradient id="google-mark__g">
          <stop offset=".231" stopColor="#0fbc5f" />
          <stop offset=".312" stopColor="#0fbc5f" />
          <stop offset=".366" stopColor="#0fbc5e" />
          <stop offset=".458" stopColor="#0fbc5d" />
          <stop offset=".54" stopColor="#12bc58" />
          <stop offset=".699" stopColor="#28bf3c" />
          <stop offset=".771" stopColor="#38c02b" />
          <stop offset=".861" stopColor="#52c218" />
          <stop offset=".915" stopColor="#67c30f" />
          <stop offset="1" stopColor="#86c504" />
        </linearGradient>
        <linearGradient id="google-mark__h">
          <stop offset=".142" stopColor="#1abd4d" />
          <stop offset=".248" stopColor="#6ec30d" />
          <stop offset=".312" stopColor="#8ac502" />
          <stop offset=".366" stopColor="#a2c600" />
          <stop offset=".446" stopColor="#c8c903" />
          <stop offset=".54" stopColor="#ebcb03" />
          <stop offset=".616" stopColor="#f7cd07" />
          <stop offset=".699" stopColor="#fdcd04" />
          <stop offset=".771" stopColor="#fdce05" />
          <stop offset=".861" stopColor="#ffce0a" />
        </linearGradient>
        <linearGradient id="google-mark__f">
          <stop offset=".316" stopColor="#ff4c3c" />
          <stop offset=".604" stopColor="#ff692c" />
          <stop offset=".727" stopColor="#ff7825" />
          <stop offset=".885" stopColor="#ff8d1b" />
          <stop offset="1" stopColor="#ff9f13" />
        </linearGradient>
        <linearGradient id="google-mark__b">
          <stop offset=".231" stopColor="#ff4541" />
          <stop offset=".312" stopColor="#ff4540" />
          <stop offset=".458" stopColor="#ff4640" />
          <stop offset=".54" stopColor="#ff473f" />
          <stop offset=".699" stopColor="#ff5138" />
          <stop offset=".771" stopColor="#ff5b33" />
          <stop offset=".861" stopColor="#ff6c29" />
          <stop offset="1" stopColor="#ff8c18" />
        </linearGradient>
        <linearGradient id="google-mark__d">
          <stop offset=".408" stopColor="#fb4e5a" />
          <stop offset="1" stopColor="#ff4540" />
        </linearGradient>
        <linearGradient id="google-mark__c">
          <stop offset=".132" stopColor="#0cba65" />
          <stop offset=".21" stopColor="#0bb86d" />
          <stop offset=".297" stopColor="#09b479" />
          <stop offset=".396" stopColor="#08ad93" />
          <stop offset=".477" stopColor="#0aa6a9" />
          <stop offset=".568" stopColor="#0d9cc6" />
          <stop offset=".667" stopColor="#1893dd" />
          <stop offset=".769" stopColor="#258bf1" />
          <stop offset=".859" stopColor="#3086ff" />
        </linearGradient>
        <linearGradient id="google-mark__e">
          <stop offset=".366" stopColor="#ff4e3a" />
          <stop offset=".458" stopColor="#ff8a1b" />
          <stop offset=".54" stopColor="#ffa312" />
          <stop offset=".616" stopColor="#ffb60c" />
          <stop offset=".771" stopColor="#ffcd0a" />
          <stop offset=".861" stopColor="#fecf0a" />
          <stop offset=".915" stopColor="#fecf08" />
          <stop offset="1" stopColor="#fdcd01" />
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          href="#google-mark__a"
          id="google-mark__s"
          x1="219.7"
          x2="254.467"
          y1="329.535"
          y2="329.535"
        />
        <radialGradient
          cx="109.627"
          cy="135.862"
          fx="109.627"
          fy="135.862"
          gradientTransform="matrix(-1.93688 1.043 1.45573 2.55542 290.525 -400.634)"
          gradientUnits="userSpaceOnUse"
          href="#google-mark__b"
          id="google-mark__m"
          r="71.46"
        />
        <radialGradient
          cx="45.259"
          cy="279.274"
          fx="45.259"
          fy="279.274"
          gradientTransform="matrix(-3.5126 -4.45809 -1.69255 1.26062 870.8 191.554)"
          gradientUnits="userSpaceOnUse"
          href="#google-mark__c"
          id="google-mark__n"
          r="71.46"
        />
        <radialGradient
          cx="304.017"
          cy="118.009"
          fx="304.017"
          fy="118.009"
          gradientTransform="matrix(2.06435 0 0 2.59204 -297.679 -151.747)"
          gradientUnits="userSpaceOnUse"
          href="#google-mark__d"
          id="google-mark__l"
          r="47.854"
        />
        <radialGradient
          cx="181.001"
          cy="177.201"
          fx="181.001"
          fy="177.201"
          gradientTransform="matrix(-.24858 2.08314 2.96249 .33417 -255.146 -331.164)"
          gradientUnits="userSpaceOnUse"
          href="#google-mark__e"
          id="google-mark__o"
          r="71.46"
        />
        <radialGradient
          cx="207.673"
          cy="108.097"
          fx="207.673"
          fy="108.097"
          gradientTransform="matrix(-1.2492 1.34326 -3.89684 -3.4257 880.501 194.905)"
          gradientUnits="userSpaceOnUse"
          href="#google-mark__f"
          id="google-mark__p"
          r="41.102"
        />
        <radialGradient
          cx="109.627"
          cy="135.862"
          fx="109.627"
          fy="135.862"
          gradientTransform="matrix(-1.93688 -1.043 1.45573 -2.55542 290.525 838.683)"
          gradientUnits="userSpaceOnUse"
          href="#google-mark__g"
          id="google-mark__r"
          r="71.46"
        />
        <radialGradient
          cx="154.87"
          cy="145.969"
          fx="154.87"
          fy="145.969"
          gradientTransform="matrix(-.0814 -1.93722 2.92674 -.11625 -215.135 632.86)"
          gradientUnits="userSpaceOnUse"
          href="#google-mark__h"
          id="google-mark__j"
          r="71.46"
        />
        <filter
          colorInterpolationFilters="sRGB"
          height="1.116"
          id="google-mark__q"
          width="1.097"
          x="-.048"
          y="-.058"
        >
          <feGaussianBlur stdDeviation="1.701" />
        </filter>
        <filter
          colorInterpolationFilters="sRGB"
          height="1.02"
          id="google-mark__k"
          width="1.033"
          x="-.017"
          y="-.01"
        >
          <feGaussianBlur stdDeviation=".242" />
        </filter>
        <clipPath clipPathUnits="userSpaceOnUse" id="google-mark__i">
          <path d="M371.378 193.24H237.083v53.438h77.167c-1.241 7.563-4.026 15.003-8.105 21.786-4.674 7.773-10.451 13.69-16.373 18.196-17.74 13.498-38.42 16.258-52.783 16.258-36.283 0-67.283-23.286-79.285-54.928-.484-1.149-.805-2.335-1.197-3.507a81.115 81.115 0 0 1-4.101-25.448c0-9.226 1.569-18.057 4.43-26.398 11.285-32.897 42.985-57.467 80.179-57.467 7.481 0 14.685.884 21.517 2.648a77.668 77.668 0 0 1 33.425 18.25l40.834-39.712c-24.839-22.616-57.219-36.32-95.844-36.32-30.878 0-59.386 9.553-82.748 25.7-18.945 13.093-34.483 30.625-44.97 50.985-9.753 18.879-15.094 39.8-15.094 62.294 0 22.495 5.35 43.633 15.103 62.337v.126c10.302 19.857 25.368 36.954 43.678 49.988 15.997 11.386 44.68 26.551 84.031 26.551 22.63 0 42.687-4.051 60.375-11.644 12.76-5.478 24.065-12.622 34.301-21.804 13.525-12.132 24.117-27.139 31.347-44.404 7.23-17.265 11.097-36.79 11.097-57.957 0-9.858-.998-19.87-2.689-28.968Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#google-mark__i)" transform="matrix(.95792 0 0 .98525 -90.174 -78.856)">
        <path
          d="M92.076 219.958c.148 22.14 6.501 44.983 16.117 63.424v.127c6.949 13.392 16.445 23.97 27.26 34.452l65.327-23.67c-12.36-6.235-14.246-10.055-23.105-17.026-9.054-9.066-15.802-19.473-20.004-31.677h-.17l.17-.127c-2.765-8.058-3.037-16.613-3.14-25.503Z"
          fill="url(#google-mark__j)"
          filter="url(#google-mark__k)"
        />
        <path
          d="M237.083 79.025c-6.456 22.526-3.988 44.421 0 57.161 7.457.006 14.64.888 21.45 2.647a77.662 77.662 0 0 1 33.424 18.25l41.88-40.726c-24.81-22.59-54.667-37.297-96.754-37.332Z"
          fill="url(#google-mark__l)"
          filter="url(#google-mark__k)"
        />
        <path
          d="M236.943 78.847c-31.67 0-60.91 9.798-84.871 26.359a145.533 145.533 0 0 0-24.332 21.15c-1.904 17.744 14.257 39.551 46.262 39.37 15.528-17.936 38.495-29.542 64.056-29.542l.07.002-1.044-57.335c-.048 0-.093-.004-.14-.004Z"
          fill="url(#google-mark__m)"
          filter="url(#google-mark__k)"
        />
        <path
          d="m341.475 226.379-28.268 19.285c-1.24 7.562-4.028 15.002-8.107 21.786-4.674 7.772-10.45 13.69-16.373 18.196-17.702 13.47-38.328 16.244-52.687 16.255-14.842 25.102-17.444 37.675 1.043 57.934 22.877-.016 43.157-4.117 61.046-11.796 12.931-5.551 24.388-12.792 34.761-22.097 13.706-12.295 24.442-27.503 31.769-45 7.327-17.497 11.245-37.282 11.245-58.734Z"
          fill="url(#google-mark__n)"
          filter="url(#google-mark__k)"
        />
        <path
          d="M234.996 191.21v57.498h136.006c1.196-7.874 5.152-18.064 5.152-26.5 0-9.858-.996-21.899-2.687-30.998Z"
          fill="#3086ff"
          filter="url(#google-mark__k)"
        />
        <path
          d="M128.39 124.327c-8.394 9.119-15.564 19.326-21.249 30.364-9.753 18.879-15.094 41.83-15.094 64.324 0 .317.026.627.029.944 4.32 8.224 59.666 6.649 62.456 0-.004-.31-.039-.613-.039-.924 0-9.226 1.57-16.026 4.43-24.367 3.53-10.289 9.056-19.763 16.123-27.926 1.602-2.031 5.875-6.397 7.121-9.016.475-.997-.862-1.557-.937-1.908-.083-.393-1.876-.077-2.277-.37-1.275-.929-3.8-1.414-5.334-1.845-3.277-.921-8.708-2.953-11.725-5.06-9.536-6.658-24.417-14.612-33.505-24.216Z"
          fill="url(#google-mark__o)"
          filter="url(#google-mark__k)"
        />
        <path
          d="M162.099 155.857c22.112 13.301 28.471-6.714 43.173-12.977l-25.574-52.664a144.74 144.74 0 0 0-26.543 14.504c-12.316 8.512-23.192 18.9-32.176 30.72Z"
          fill="url(#google-mark__p)"
          filter="url(#google-mark__q)"
        />
        <path
          d="M171.099 290.222c-29.683 10.641-34.33 11.023-37.062 29.29a144.806 144.806 0 0 0 16.792 13.984c15.996 11.386 46.766 26.551 86.118 26.551.046 0 .09-.004.137-.004v-59.157l-.094.002c-14.736 0-26.512-3.843-38.585-10.527-2.977-1.648-8.378 2.777-11.123.799-3.786-2.729-12.9 2.35-16.183-.938Z"
          fill="url(#google-mark__r)"
          filter="url(#google-mark__k)"
        />
        <path
          d="M219.7 299.023v59.996c5.506.64 11.236 1.028 17.247 1.028 6.026 0 11.855-.307 17.52-.872v-59.748a105.119 105.119 0 0 1-17.477 1.461c-5.932 0-11.7-.686-17.29-1.865Z"
          fill="url(#google-mark__s)"
          filter="url(#google-mark__k)"
          opacity=".5"
        />
      </g>
    </svg>
  );
}

/**
 * The ElevenLabs wordmark, which is the only form their brand ships — there is
 * no standalone glyph to sit in a row of square logos beside Stripe and the
 * Google G.
 *
 * Two consequences. It is sized by height, because a 694×90 wordmark set by
 * width would tower over the marks next to it; and it paints in
 * `currentColor` rather than the black of the original file, so it survives
 * the dark theme instead of disappearing into it. Their brand kit permits the
 * monochrome wordmark in either polarity, which is exactly what a
 * theme-following `currentColor` gives.
 */
export function ElevenLabsMark({ height = 16 }: { readonly height?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={SIZE_CLASS}
      fill="currentColor"
      height={height}
      viewBox="0 0 694 90"
      width={(height * 694) / 90}
    >
      <path d="M248.261 22.1901H230.466L251.968 88.5124H271.123L292.625 22.1901H274.83L261.365 72.1488L248.261 22.1901Z" />
      <path d="M0 0H18.413V88.5124H0V0Z" />
      <path d="M36.5788 0H54.9917V88.5124H36.5788V0Z" />
      <path d="M73.1551 0H127.652V14.7521H91.568V35.8264H125.181V50.5785H91.568V73.7603H127.652V88.5124H73.1551V0Z" />
      <path d="M138.896 0H156.32V88.5124H138.896V0Z" />
      <path d="M166.824 55.2893C166.824 31.1157 178.811 20.7025 197.471 20.7025C216.131 20.7025 226.759 30.9917 226.759 55.5372V59.5041H184.001C184.619 73.8843 188.944 78.719 197.224 78.719C203.773 78.719 207.851 74.876 208.593 68.1818H226.017C224.905 82.8099 212.795 90 197.224 90C177.452 90 166.824 79.4628 166.824 55.2893ZM209.582 47.9752C208.717 35.8264 204.515 31.8595 197.224 31.8595C189.933 31.8595 185.36 35.9504 184.125 47.9752H209.582Z" />
      <path d="M295.962 55.2893C295.962 31.1157 307.949 20.7025 326.609 20.7025C345.269 20.7025 355.897 30.9917 355.897 55.5372V59.5041H313.139C313.757 73.8843 318.082 78.719 326.362 78.719C332.911 78.719 336.989 74.876 337.731 68.1818H355.155C354.043 82.8099 341.932 90 326.362 90C306.589 90 295.962 79.4628 295.962 55.2893ZM338.719 47.9752C337.854 35.8264 333.653 31.8595 326.362 31.8595C319.071 31.8595 314.498 35.9504 313.263 47.9752H338.719Z" />
      <path d="M438.443 0H456.856V73.7603H491.457V88.5124H438.443V0Z" />
      <path
        clipRule="evenodd"
        d="M495.783 55.2893C495.783 30 507.399 20.7025 522.352 20.7025C529.766 20.7025 536.563 24.9174 539.282 29.3802V22.1901H557.077V88.5124H539.776V80.7025C537.181 85.9091 529.89 90 521.857 90C506.04 90 495.783 79.8347 495.783 55.2893ZM526.924 33.719C535.574 33.719 540.27 40.2893 540.27 55.2893C540.27 70.2893 535.574 76.9835 526.924 76.9835C518.274 76.9835 513.331 70.2893 513.331 55.2893C513.331 40.2893 518.274 33.719 526.924 33.719Z"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M587.847 80.7025V88.5124H570.547V0H587.971V29.3802C590.937 24.7934 597.857 20.7025 605.272 20.7025C619.854 20.7025 631.47 30 631.47 55.2893C631.47 80.5785 620.101 90 604.901 90C596.869 90 590.319 85.9091 587.847 80.7025ZM600.329 33.843C608.979 33.843 613.922 40.2893 613.922 55.2893C613.922 70.2893 608.979 76.9835 600.329 76.9835C591.678 76.9835 586.982 70.2893 586.982 55.2893C586.982 40.2893 591.678 33.843 600.329 33.843Z"
        fillRule="evenodd"
      />
      <path d="M638.638 68.8017H656.062C656.309 75.7438 660.016 79.0909 666.566 79.0909C673.115 79.0909 676.823 76.1157 676.823 70.9091C676.823 66.1983 673.981 64.4628 667.802 62.9752L662.488 61.6116C647.412 57.7686 639.873 53.6777 639.873 41.157C639.873 28.6364 651.49 20.7025 666.319 20.7025C681.148 20.7025 692.394 26.5289 692.888 40.2893H675.463C675.093 34.2149 671.385 31.6116 666.072 31.6116C660.758 31.6116 657.05 34.2149 657.05 39.1736C657.05 43.7603 660.016 45.4959 665.207 46.7355L670.644 48.0992C684.979 51.6942 694 55.2893 694 68.6777C694 82.0661 682.137 90 666.072 90C648.647 90 639.008 83.4297 638.638 68.8017Z" />
      <path d="M384.072 49.4628C384.072 39.0496 389.015 33.3471 396.677 33.3471C402.979 33.3471 406.563 37.314 406.563 45.8678V88.5124H423.987V43.1405C423.987 27.7686 415.337 20.7025 402.732 20.7025C394.205 20.7025 387.162 25.0413 384.072 30.7438V22.1901H366.401V88.5124H384.072V49.4628Z" />
    </svg>
  );
}
