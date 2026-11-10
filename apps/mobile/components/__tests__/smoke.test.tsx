import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

test('the test runner renders React Native components', async () => {
  const { getByText } = await render(
    <View>
      <Text>OnePeek</Text>
    </View>,
  );
  expect(getByText('OnePeek')).toBeTruthy();
});
