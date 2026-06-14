import { Stack } from 'expo-router';
import { Colors } from '../../constants/theme';

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="subscription-plan" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="store-setup" />
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="orders" />
      <Stack.Screen name="sales" />
      <Stack.Screen name="add-product" />
      <Stack.Screen name="edit-product" />
      <Stack.Screen name="edit-product-details/[id]" />
      <Stack.Screen name="stores" />
      <Stack.Screen name="subscription" />
      <Stack.Screen name="payout" />
    </Stack>
  );
}
