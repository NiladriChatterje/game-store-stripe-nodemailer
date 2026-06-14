import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useUserStore } from '../../store/userStore';
import { useCartStore } from '../../store/cartStore';
import { userService } from '../../services/userService';
import { API, GEOAPIFY } from '../../constants/config';
import * as Location from 'expo-location';

interface UserContextType {
  isRefreshing: boolean;
  refreshUserData: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  isRefreshing: false,
  refreshUserData: async () => {},
});

export function useUserContext() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const { userData, setUserData, setCart } = useUserStore();
  const { items } = useCartStore();
  const isFetching = useRef(false);

  const fetchUserData = async () => {
    if (!isSignedIn || !user || isFetching.current) return;
    isFetching.current = true;

    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(
        `${API.USER_DATA}/fetch-user-data/${user.id}`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        // User doesn't exist yet - create them
        await createNewUser(token);
        return;
      }

      const data = await response.json();
      if (data) {
        setUserData(data);
      } else {
        await createNewUser(token);
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
    } finally {
      isFetching.current = false;
    }
  };

  const createNewUser = async (token: string) => {
    if (!user) return;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let latitude = 0;
      let longitude = 0;
      let postcode = '';
      let county = '';
      let state = '';
      let country = '';

      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;

        // Reverse geocode
        try {
          const geoRes = await fetch(
            `https://api.geoapify.com/v1/geocode/reverse?lat=${latitude}&lon=${longitude}&apiKey=${GEOAPIFY.API_KEY}`
          );
          const geoData = await geoRes.json();
          const props = geoData.features?.[0]?.properties;
          if (props) {
            postcode = props.postcode || '';
            county = props.county || '';
            state = props.state || '';
            country = props.country || '';
          }
        } catch {}
      }

      const userObj = {
        _id: user.id,
        username: user.firstName || '',
        geoPoint: { lat: latitude, lng: longitude },
        email: user.emailAddresses?.[0]?.emailAddress || '',
        address: { pincode: postcode, county, state, country },
        cart: items.map((item) => ({
          _id: item.productId,
          quantity: item.quantity,
        })),
      };

      const res = await userService.createUser(userObj);
      if (res.ok) {
        setUserData(userObj as any);
      }
    } catch (err) {
      console.error('Error creating user:', err);
    }
  };

  const fetchCart = async () => {
    if (!userData?._id) return;
    try {
      const res = await userService.fetchUserCart(userData._id);
      if (res.ok && res.data) {
        setCart(res.data);
      }
    } catch (err) {
      console.error('Error fetching cart:', err);
    }
  };

  useEffect(() => {
    fetchUserData();
  }, [isSignedIn]);

  useEffect(() => {
    if (userData) {
      fetchCart();
    }
  }, [userData?._id]);

  return (
    <UserContext.Provider
      value={{
        isRefreshing: isFetching.current,
        refreshUserData: fetchUserData,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
