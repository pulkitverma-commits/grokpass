'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders a QR code for `value` entirely in the browser (nothing is sent anywhere). */
export default function QrCode({ value, size = 240, label }: { value: string; size?: number; label?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#0A0C0F', light: '#FFFFFF' } })
      .then(url => { if (live) setSrc(url); })
      .catch(() => setSrc(''));
    return () => { live = false; };
  }, [value, size]);
  return (
    <div className="qr-box" style={{ width: size + 24 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={label || 'QR code'} width={size} height={size} /> : <div style={{ width: size, height: size }} />}
      {label && <span>{label}</span>}
    </div>
  );
}
