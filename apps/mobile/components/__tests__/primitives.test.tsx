/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require() */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import { Avatar, initials } from '../Avatar';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Field } from '../Field';
import { ListRow } from '../ListRow';
import { Notice, Toast } from '../Notice';
import { Segmented } from '../Segmented';
import { Sheet } from '../Sheet';
import { Text } from '../Text';
import { colors, fonts, maxFontSizeMultiplier } from '../../theme';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

describe('Text', () => {
  it('uses Questrial for UI, Geist Mono for mono/label, and caps dynamic type', async () => {
    await render(<><Text testID="ui">a</Text><Text testID="mono" mono>b</Text><Text testID="label" variant="label">c</Text></>);
    expect(screen.getByTestId('ui').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontFamily: fonts.ui })]));
    expect(screen.getByTestId('mono').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontFamily: fonts.mono })]));
    expect(screen.getByTestId('label').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontFamily: fonts.mono })]));
    expect(screen.getByTestId('ui').props.maxFontSizeMultiplier).toBe(maxFontSizeMultiplier);
    expect(screen.getByTestId('ui').props.allowFontScaling).toBe(true);
  });
});

describe('Button', () => {
  it('is a 44pt+ button that fires onPress and announces its title', async () => {
    const onPress = jest.fn();
    await render(<Button title="Get started" onPress={onPress} testID="btn" />);
    const btn = screen.getByTestId('btn');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe('Get started');
    const flat = Object.assign({}, ...[btn.props.style].flat(Infinity).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    expect(flat.backgroundColor).toBe(colors.accent);
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('does not fire while disabled or busy', async () => {
    const onPress = jest.fn();
    await render(<><Button title="A" onPress={onPress} disabled testID="a" /><Button title="B" onPress={onPress} busy testID="b" /></>);
    await fireEvent.press(screen.getByTestId('a'));
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('a').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });
  it('P3-A1: destructive text meets 4.5:1 on the danger red (dark text, 7.06:1)', async () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };
    await render(<Button title="Burn chat" variant="destructive" testID="d" />);
    const btn = screen.getByTestId('d');
    const bg = Object.assign({}, ...[btn.props.style].flat(Infinity).filter(Boolean)).backgroundColor as string;
    const label = screen.getByText('Burn chat');
    const fg = Object.assign({}, ...[label.props.style].flat(Infinity).filter(Boolean)).color as string;
    expect(bg).toBe(colors.danger);
    expect(fg).toBe(colors.onDanger);
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(fg, bg)).toBeCloseTo(7.06, 1);
    expect(ratio(colors.danger, colors.bg)).toBeGreaterThanOrEqual(4.5);   // danger as text stays readable
  });
  it('renders the four variants', async () => {
    await render(<>{(['primary', 'secondary', 'ghost', 'destructive'] as const).map((v) => <Button key={v} title={v} variant={v} testID={v} />)}</>);
    for (const v of ['primary', 'secondary', 'ghost', 'destructive']) expect(screen.getByTestId(v)).toBeTruthy();
  });
});

describe('Field', () => {
  it('shows label, helper and error, and reports text changes', async () => {
    const onChangeText = jest.fn();
    const { rerender } = await render(<Field label="Email" helper="We never share it" value="" onChangeText={onChangeText} testID="f" />);
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('We never share it')).toBeTruthy();
    expect(screen.getByTestId('f').props.accessibilityLabel).toBe('Email');
    await fireEvent.changeText(screen.getByTestId('f'), 'a@b.co');
    expect(onChangeText).toHaveBeenCalledWith('a@b.co');
    await rerender(<Field label="Email" error="Enter your email address." value="" onChangeText={onChangeText} testID="f" />);
    expect(screen.getByText('Enter your email address.')).toBeTruthy();
    expect(screen.queryByText('We never share it')).toBeNull();
  });
  it('mono variant uses Geist Mono', async () => {
    await render(<Field mono value="" testID="code" />);
    expect(screen.getByTestId('code').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontFamily: fonts.mono })]));
  });
});

describe('Segmented', () => {
  it('marks the chosen option and reports changes', async () => {
    const onChange = jest.fn();
    await render(<Segmented label="Timer" value={30} onChange={onChange} options={[{ value: 10, label: '10s', testID: 't10' }, { value: 30, label: '30s', testID: 't30' }]} />);
    expect(screen.getByTestId('t30').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('t10').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    await fireEvent.press(screen.getByTestId('t10'));
    expect(onChange).toHaveBeenCalledWith(10);
  });
});

describe('Sheet', () => {
  it('shows its title and children when open and closes from the handle', async () => {
    const onClose = jest.fn();
    await render(<Sheet open onClose={onClose} title="Invite someone" testID="sheet"><RNText>body</RNText></Sheet>);
    expect(screen.getByText('Invite someone')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sheet.handle'));
    expect(onClose).toHaveBeenCalled();
  });
  it('renders nothing when closed', async () => {
    await render(<Sheet open={false} onClose={() => {}}><RNText>body</RNText></Sheet>);
    expect(screen.queryByText('body')).toBeNull();
  });
});

describe('ListRow', () => {
  it('is pressable, labelled and at least 56pt', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Vault handover" subtitle="Secret Chat · ends in 5h" onPress={onPress} testID="row" chevron />);
    const row = screen.getByTestId('row');
    expect(row.props.accessibilityLabel).toBe('Vault handover, Secret Chat · ends in 5h');
    const flat = Object.assign({}, ...[row.props.style].flat(Infinity).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(56);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Badge, Avatar, Notice, Toast', () => {
  it('Badge shows its label', async () => {
    await render(<Badge label="Secret" tone="secure" icon="lock" testID="b" />);
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Secret');
    expect(screen.getByText('Secret')).toBeTruthy();
  });
  it('Avatar derives initials from a nickname', async () => {
    expect(initials('Sam Okonkwo')).toBe('SO');
    expect(initials('bea')).toBe('B');
    expect(initials('')).toBe('?');
    await render(<Avatar name="Sam Okonkwo" />);
    expect(screen.getByText('SO')).toBeTruthy();
  });
  it('Notice is a live alert region', async () => {
    await render(<Notice tone="error" text="That access code isn’t right." testID="n" />);
    expect(screen.getByTestId('n').props.accessibilityRole).toBe('alert');
    expect(screen.getByText('That access code isn’t right.')).toBeTruthy();
  });
  it('Toast shows a message when one arrives', async () => {
    const { rerender } = await render(<Toast message="" testID="t" />);
    expect(screen.queryByTestId('t')).toBeNull();
    await rerender(<Toast message="Copied" testID="t" />);
    expect(screen.getByText('Copied')).toBeTruthy();
  });
});
