type InterfaceIconName =
  | "arrow-down"
  | "arrow-up"
  | "chevron-left"
  | "chevron-right"
  | "close";

interface InterfaceIconProps {
  name: InterfaceIconName;
  size?: number;
}

export default function InterfaceIcon({
  name,
  size = 18,
}: InterfaceIconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "chevron-left" && <path d="M15 18l-6-6 6-6" />}
      {name === "chevron-right" && <path d="M9 18l6-6-6-6" />}
      {name === "arrow-up" && <path d="M12 19V5M5 12l7-7 7 7" />}
      {name === "arrow-down" && <path d="M12 5v14m7-7-7 7-7-7" />}
      {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
    </svg>
  );
}
