/**
 * The icon set used by the design, inlined. Lucide-style 24×24 strokes, copied from
 * the design's own SVG paths so the shapes match exactly — and inlined rather than
 * pulled from a package so the offline app shell has no icon font to miss.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  viewBox: "0 0 24 24",
  width: size,
  height: size,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

export function PinIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function BellIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function HeartIcon({ size = 17, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size)} fill={filled ? "currentColor" : "none"}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

export function ArrowIcon({ size = 14 }: IconProps) {
  // Points to the inline-start edge; the parent flips with `dir`.
  return (
    <svg {...base(size)} style={{ transform: "scaleX(var(--arrow-flip, 1))" }}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function ChevronIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)} style={{ transform: "scaleX(var(--arrow-flip, 1))" }}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function HomeIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function SearchIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function MapIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764V20" />
      <path d="M9 3.236v15" />
    </svg>
  );
}

export function BookmarkIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}

export function UserIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function CheckIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={3}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function SlidersIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </svg>
  );
}

export function ShareIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" x2="12" y1="2" y2="15" />
    </svg>
  );
}

export function PhoneIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function PlusIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function SettingsIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function AlertIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

export function CloudOffIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m2 2 20 20" />
      <path d="M5.8 5.8A6 6 0 0 0 8 18h9a4 4 0 0 0 2.5-7.1" />
      <path d="M16.7 10.4A6 6 0 0 0 9.6 5.3" />
    </svg>
  );
}

export function CrosshairIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
    </svg>
  );
}

export function CloseIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
