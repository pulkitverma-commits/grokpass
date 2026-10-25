// Flat, single-colour line icons (inherit currentColor).
type Name = 'shield' | 'flame' | 'image' | 'eye' | 'lock' | 'key' | 'ban' | 'clock' | 'file' | 'check';

const PATHS: Record<Name, JSX.Element> = {
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  flame: <path d="M12 22c4 0 7-2.7 7-7 0-4-3-6.5-4.5-9.5C13.5 8 12 9 10.5 9 10.5 6 9 4 8 2.5 6 6 5 9.5 5 15c0 4.3 3 7 7 7Z" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M10.85 12.15 19 4" /><path d="m18 5 2 2" /><path d="m15 8 2 2" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
};

export default function Icon({ name, size = 18, strokeWidth = 1.9, className, style }: { name: Name; size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={{ flex: 'none', ...style }}>
      {PATHS[name]}
    </svg>
  );
}
