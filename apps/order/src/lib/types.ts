export interface Store {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  pickupTime: string;
  isOpen: boolean;
  isBusy: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  image?: string;
}

export interface ModifierOption {
  id: string;
  label: string;
  priceDelta: number;
  isDefault: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  multiSelect: boolean; // true = checkboxes (Add Ons), false = radio (Temperature, Packaging)
  options: ModifierOption[];
}

export interface ProductVariant {
  id: string;
  name: string;
  price: number;
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  basePrice: number;
  image: string;
  imageZoom?: number;   // 50–200, default 100
  variants: ProductVariant[]; // kept for backward compat — usually empty
  modifierGroups: ModifierGroup[]; // pulled from StoreHub variantGroups
  isPopular?: boolean;
  isNew?: boolean;
  isAvailable: boolean;
}

export interface CartModifierSelection {
  groupId: string;
  groupName: string;
  optionId: string;
  label: string;
  priceDelta: number;
}

export interface CartItemModifiers {
  selections: CartModifierSelection[];
  specialInstructions?: string;
}

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  modifiers: CartItemModifiers;
  totalPrice: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  storeId: string;
  items: CartItem[];
  subtotal: number;
  total: number;
  status: "pending" | "paid" | "preparing" | "ready" | "completed";
  pickupTime: string;
  paymentMethod: string;
  createdAt: string;
}
