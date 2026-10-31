// Shared test setup. Native modules that need a device are mocked here so every test file starts
// from the same baseline; a test may override a mock locally.
jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
    setItem: (k: string, v: string) => void items.set(k, v),
    getItem: (k: string) => items.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void items.set(k, v),
    getItemAsync: async (k: string) => items.get(k) ?? null,
    deleteItemAsync: async (k: string) => void items.delete(k),
    __items: items,
  };
});
