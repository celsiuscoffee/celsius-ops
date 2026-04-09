import type { Store, Category, Product } from "@/lib/types";

export const stores: Store[] = [
  {
    id: "shah-alam",
    name: "Celsius Shah Alam",
    address: "No. 12, Jalan Plumbum V 7/V, Seksyen 7, 40000 Shah Alam",
    lat: 3.0733,
    lng: 101.5185,
    pickupTime: "~7 min",
    isOpen: true,
    isBusy: false,
  },
  {
    id: "conezion",
    name: "Celsius Conezion",
    address: "IOI Resort City, Conezion, 62502 Putrajaya",
    lat: 2.9375,
    lng: 101.7156,
    pickupTime: "~10 min",
    isOpen: true,
    isBusy: true,
  },
  {
    id: "tamarind",
    name: "Celsius Tamarind Square",
    address: "Tamarind Square, Persiaran Multimedia, 63000 Cyberjaya",
    lat: 2.9264,
    lng: 101.6553,
    pickupTime: "~5 min",
    isOpen: true,
    isBusy: false,
  },
];

export const categories: Category[] = [
  { id: "classic", name: "Classic", slug: "classic" },
  { id: "flavoured", name: "Flavoured", slug: "flavoured" },
  { id: "artisan-matcha", name: "Artisan Matcha", slug: "artisan-matcha" },
  { id: "artisan-choc", name: "Artisan Choc", slug: "artisan-choc" },
];

const drinkModifiers: Product["modifierGroups"] = [
  {
    id: "mock-temperature",
    name: "Temperature",
    multiSelect: false,
    options: [
      { id: "hot", label: "Hot", priceDelta: 0, isDefault: true },
      { id: "iced", label: "Iced", priceDelta: 1, isDefault: false },
    ],
  },
  {
    id: "mock-addons",
    name: "Add Ons",
    multiSelect: true,
    options: [
      { id: "oatmilk", label: "Oatmilk", priceDelta: 3, isDefault: false },
      { id: "extra-shot", label: "Extra Shot", priceDelta: 3, isDefault: false },
      { id: "extra-syrup", label: "Extra Syrup", priceDelta: 2, isDefault: false },
    ],
  },
  {
    id: "mock-packaging",
    name: "Packaging",
    multiSelect: false,
    options: [
      { id: "dine-in", label: "Dine In", priceDelta: 0, isDefault: true },
      { id: "takeaway", label: "Packaging", priceDelta: 0.97, isDefault: false },
    ],
  },
];

export const products: Product[] = [
  {
    id: "celsius-latte",
    categoryId: "classic",
    name: "Celsius Latte",
    description: "Our signature latte with perfectly steamed milk and a double shot of espresso.",
    basePrice: 11,
    image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&h=400&fit=crop&q=80",
    variants: [],
    modifierGroups: drinkModifiers,
    isPopular: true,
    isAvailable: true,
  },
  {
    id: "americano",
    categoryId: "classic",
    name: "Americano",
    description: "Double shot espresso with hot or cold water. Simple and bold.",
    basePrice: 8,
    image: "https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=400&h=400&fit=crop&q=80",
    variants: [],
    modifierGroups: drinkModifiers,
    isPopular: true,
    isAvailable: true,
  },
  {
    id: "matcha-latte",
    categoryId: "artisan-matcha",
    name: "Matcha Latte",
    description: "Premium Japanese matcha whisked with steamed milk for a smooth, earthy flavour.",
    basePrice: 12,
    image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=400&h=400&fit=crop&q=80",
    variants: [],
    modifierGroups: drinkModifiers,
    isNew: true,
    isAvailable: true,
  },
];
