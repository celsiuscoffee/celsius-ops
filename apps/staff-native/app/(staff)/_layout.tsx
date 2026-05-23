import { Tabs } from "expo-router";
import { Home, Clock, Briefcase, Receipt, User } from "lucide-react-native";

export default function StaffLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1A0200",
        tabBarInactiveTintColor: "#6B6B6B",
        tabBarStyle: {
          borderTopColor: "rgba(26, 2, 0, 0.10)",
          paddingTop: 4,
          height: 84,
        },
        tabBarLabelStyle: { fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="clock"
        options={{
          title: "Clock",
          tabBarIcon: ({ color, size }) => <Clock color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="hr"
        options={{
          title: "HR",
          tabBarIcon: ({ color, size }) => (
            <Briefcase color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="claims"
        options={{
          title: "Claims",
          tabBarIcon: ({ color, size }) => (
            <Receipt color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
