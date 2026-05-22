import { View, Text, ScrollView, Pressable } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Clock, Users, CheckCircle2 } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { supabase, type Outlet } from "../lib/supabase";
import { useApp, cartCount } from "../lib/store";
import { EspressoHeader } from "../components/EspressoHeader";
import { CelsiusLoader } from "../components/CelsiusLoader";

async function fetchOutlets(): Promise<Outlet[]> {
  const { data, error } = await supabase
    .from("outlet_settings")
    .select("store_id,name,address,lat,lng,is_open,is_busy,pickup_time_mins")
    .eq("is_active", true)
    .order("store_id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export default function StorePicker() {
  const params = useLocalSearchParams<{ next?: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["outlets"],
    queryFn: fetchOutlets,
  });
  const setOutlet = useApp((s) => s.setOutlet);
  const outletId = useApp((s) => s.outletId);
  const cart = useApp((s) => s.cart);

  // First-time pickers arrive here from the menu redirect (?next=menu).
  // After they select an outlet we send them straight to /menu via
  // replace so the back stack doesn't grow Menu→Store→Menu. Cart > 0
  // takes priority — they're mid-checkout, route to /cart so they
  // don't lose their place. Otherwise honor `next`, defaulting to /menu.
  const onPick = (o: Outlet) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOutlet(o.store_id, o.name);
    if (cartCount(cart) > 0) {
      router.replace("/cart");
    } else if (params.next === "menu") {
      router.replace("/menu");
    } else {
      router.replace("/menu");
    }
  };

  // Consistent header across platforms: always "Pickup outlet" with the
  // same eyebrow copy. Show back only when there's a screen to return
  // to — first-pickers landing here from the menu redirect have no
  // back history, so the chevron stays hidden until navigation depth >0.
  const headerTitle = "Pickup outlet";
  const eyebrowCopy = "Outlets near you";

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title={headerTitle} showBack={router.canGoBack()} showCart={false} />

      <ScrollView contentContainerClassName="px-4 py-4 pb-12 gap-3">
        <Text className="text-muted-fg text-[11px] font-bold uppercase tracking-wider px-0.5 mb-1">
          {eyebrowCopy}
        </Text>

        {isLoading && (
          <View className="py-12 items-center">
            <CelsiusLoader size="md" />
          </View>
        )}

        {error && (
          <View className="py-12 items-center px-4">
            <Text className="text-muted-fg text-center">Couldn't load outlets.</Text>
          </View>
        )}

        {data?.map((o) => {
          const selected = outletId === o.store_id;
          return (
            <Pressable
              key={o.store_id}
              onPress={() => onPick(o)}
              disabled={!o.is_open}
              className={`bg-surface rounded-2xl p-4 flex-row items-start gap-3.5 active:opacity-70 ${
                selected ? "border-2 border-espresso" : "border border-border"
              } ${!o.is_open ? "opacity-50" : ""}`}
              style={{
                shadowColor: "#000",
                shadowOpacity: 0.04,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
              }}
            >
              <View className={`rounded-2xl p-2.5 mt-0.5 ${selected ? "bg-primary/15" : "bg-primary/10"}`}>
                <MapPin size={20} color="#A2492C" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2 flex-wrap">
                  <Text className="text-espresso font-bold text-[15px]">{o.name}</Text>
                  {o.is_busy && o.is_open && (
                    <View className="flex-row items-center gap-1 bg-amber-50 px-1.5 py-0.5 rounded">
                      <Users size={10} color="#B45309" />
                      <Text className="text-[10px] text-amber-500 font-medium">Busy</Text>
                    </View>
                  )}
                  {!o.is_open && (
                    <View className="bg-background px-1.5 py-0.5 rounded">
                      <Text className="text-[10px] text-muted-fg font-medium">Closed</Text>
                    </View>
                  )}
                </View>
                <Text className="text-muted-fg text-xs mt-1 leading-relaxed" numberOfLines={2}>
                  {o.address}
                </Text>
                <View className="flex-row items-center gap-4 mt-2">
                  <View className="flex-row items-center gap-1">
                    <Clock size={12} color="#6E6E73" />
                    <Text className="text-muted-fg text-xs">~{o.pickup_time_mins} min</Text>
                  </View>
                </View>
              </View>
              {selected && <CheckCircle2 size={20} color="#160800" />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
