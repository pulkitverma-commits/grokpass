// Renders a screen inside the providers it expects (safe area, ChatProvider).
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ChatProvider } from '../components/ChatProvider';

export function renderScreen(ui: ReactElement) {
  // The testing library's types resolve the workspace root's React 18 typings; the app runs React 19.
  return render(ui as unknown as Parameters<typeof render>[0], { wrapper: ({ children }) => <ChatProvider>{children}</ChatProvider> });
}
