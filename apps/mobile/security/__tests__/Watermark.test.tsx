import { render } from '@testing-library/react-native';

import { Watermark, shortDeviceCode, watermarkText } from '@/security/Watermark';

const NOW = Date.UTC(2026, 9, 31, 14, 5);

describe('Watermark', () => {
  test('text is `<name> · <code> · <stamp>` with the web format and is repeated', async () => {
    const r = await render(<Watermark viewerName="Aanya" deviceCode="3F9A" now={NOW} />);
    const expected = watermarkText('Aanya', '3F9A', NOW);
    expect(expected.startsWith('Aanya · 3F9A · ')).toBe(true);
    expect(expected).toBe(`Aanya · 3F9A · ${new Date(NOW).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
    expect(r.getAllByText(expected, { includeHiddenElements: true }).length).toBe(24);
  });

  test('never takes touches and is hidden from assistive tech', async () => {
    const r = await render(<Watermark viewerName="Aanya" deviceCode="3F9A" now={NOW} />);
    const layer = r.getByTestId('security.watermark', { includeHiddenElements: true });
    expect(layer.props.pointerEvents).toBe('none');
    expect(layer.props.accessibilityElementsHidden).toBe(true);
    expect(layer.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  test('device code is the web shortId: 4 hex chars, upper-case, dashes removed', () => {
    expect(shortDeviceCode('3f9a1c2e-0000-4000-8000-000000000000')).toBe('3F9A');
  });
});
