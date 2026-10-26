import { HugeiconsIcon } from "../icons/icon";
import { Loading03Icon } from "@hugeicons/core-free-icons";

import { cn } from "../../lib/utils";

function Spinner({
  className,
  ...props
}: Omit<React.ComponentProps<typeof HugeiconsIcon>, "icon">) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      size={16}
      strokeWidth={1.75}
      role="status"
      aria-label="Loading"
      // `motion-reduce:` sorts after the base utility, so it is the one that
      // lands when someone has asked the OS for less motion — a bare
      // `animate-none` from a caller would be a coin toss on stylesheet order.
      className={cn("animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Spinner };
