import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-static';

export function GET() {
  const svg = readFileSync(join(process.cwd(), 'public/onepeek-logo.svg'));
  const logo = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={1000} height={264} alt="" />
      </div>
    ),
    { width: 1000, height: 264 },
  );
}
