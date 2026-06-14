import { Stack } from 'expo-router';
import { Colors } from '../../constants/theme';

export default function ShipperLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="in-transit" />
      <Stack.Screen name="delivered" />
      <Stack.Screen name="order-details/[id]" />
    </Stack>
  );
}
