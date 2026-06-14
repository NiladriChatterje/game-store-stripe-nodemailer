import { Stack } from 'expo-router';
import { Colors } from '../../constants/theme';
import { UserProvider } from './UserProvider';

export default function UserLayout() {
  return (
    <UserProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="products" />
        <Stack.Screen name="product-detail/[id]" />
        <Stack.Screen name="cart" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="checkout" />
        <Stack.Screen name="completion" />
        <Stack.Screen name="orders" />
        <Stack.Screen name="delivery" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="about" />
      </Stack>
    </UserProvider>
  );
}
