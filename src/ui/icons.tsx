import type { CSSProperties } from 'react';

const P: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  flip: 'M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2M20 4v4h-4M4 20v-4h4',
  wand: 'M5 19L15 9M14 4v2M19 9h2M17.5 6.5l1.5-1.5M10 4.5l.8 1.2M19.5 13.5l-1.2-.8',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  pen: 'M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3',
  text: 'M5 6h14M12 6v13M9 19h6',
  hd: 'M3 6h18v12H3zM7 9v6M7 12h3M10 9v6M14 9v6h2a3 3 0 0 0 0-6h-2z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3h16v-3',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  play: 'M8 5l11 7-11 7z',
  pause: 'M8 5v14M16 5v14',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  plus: 'M12 5v14M5 12h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  cc: 'M3 5h18v14H3zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  send: 'M4 12l16-8-6 16-3-7z',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 3 7 3 7H3s3-1 3-7M10 20a2 2 0 0 0 4 0',
  bellOff: 'M6 9a6 6 0 0 1 9.5-4.9M18 9c0 6 3 7 3 7H8M10 20a2 2 0 0 0 4 0M3 3l18 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  wave: 'M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2',
  check: 'M5 12l5 5 9-10',
  speed: 'M12 21a9 9 0 1 1 9-9M12 12l5-4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  laugh: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14c1 2 2.4 3 4 3s3-1 4-3zM8.5 9.5l1.5 1M15.5 9.5l-1.5 1',
  wow: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a2 2.5 0 1 0 0-5 2 2.5 0 0 0 0 5zM9 9h.01M15 9h.01',
  fire: 'M12 21c-4 0-6-2.7-6-6 0-4 4-6 4-10 2 1 6 4 6 8 1-1 1.5-2 1.5-3 1.5 1.5 2.5 3.5 2.5 5 0 3.3-3 6-8 6z',
  clap: 'M8 13l5-5a1.5 1.5 0 0 1 2 2l-3 3M10 15l5-5a1.5 1.5 0 0 1 2 2l-5 5a5 5 0 0 1-7 0 5 5 0 0 1 0-7l3-3a1.5 1.5 0 0 1 2 2M16 4l1-2M19 6l2-1M20 9h2',
  cry: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 16c1-1.3 2.2-2 3.5-2s2.5.7 3.5 2M9 9.5h.01M15 9.5h.01M8 11.5v2',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

export function Icon({ name, size = 22, stroke = 2, fill, style, className }: { name: keyof typeof P | string; size?: number; stroke?: number; fill?: string; style?: CSSProperties; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || 'none'} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
      <path d={P[name] || ''} />
    </svg>
  );
}

export const REACTIONS = [
  { id: 'heart', label: 'Love', color: '#ff4f7b' },
  { id: 'laugh', label: 'Haha', color: '#ffb02e' },
  { id: 'wow', label: 'Wow', color: '#59c9ff' },
  { id: 'fire', label: 'Fire', color: '#ff6a3d' },
  { id: 'clap', label: 'Clap', color: '#b98cff' },
  { id: 'cry', label: 'Aww', color: '#6fd3a8' },
];
