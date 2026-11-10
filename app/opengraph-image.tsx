import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';

export const alt = 'OnePeek: send secrets that disappear';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  const svg = readFileSync(join(process.cwd(), 'public/onepeek-logo.svg'));
  const logo = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const grid = 'rgba(255,255,255,0.04)';
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0C0F',
          backgroundImage: `radial-gradient(circle at 50% 22%, rgba(46,221,170,0.16), rgba(10,12,15,0) 55%), linear-gradient(180deg, ${grid} 1px, transparent 1px), linear-gradient(90deg, ${grid} 1px, transparent 1px)`,
          backgroundSize: '100% 100%, 48px 48px, 48px 48px',
          color: '#F4F5F6',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={640} height={169} alt="" />
        <div style={{ marginTop: 34, fontSize: 50, letterSpacing: -1 }}>Send secrets that disappear.</div>
        <div style={{ marginTop: 20, fontSize: 20, letterSpacing: 3, textTransform: 'uppercase', color: '#A3ABB6' }}>
          Encrypted in your browser · read once · gone
        </div>
      </div>
    ),
    size,
  );
}
