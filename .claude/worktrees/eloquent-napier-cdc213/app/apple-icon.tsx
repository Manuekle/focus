import { ImageResponse } from "next/og";
import { MARK_ON_LIGHT } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";


export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#e8e8e8",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <img alt="" src={MARK_ON_LIGHT} width={100} height={119} style={{ objectFit: "contain" }} />
      </div>
    ),
    size,
  );
}
