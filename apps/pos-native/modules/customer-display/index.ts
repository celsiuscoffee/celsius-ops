import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Native handle for the secondary-display Presentation module. Optional
 * so the app keeps running where it isn't compiled in (Expo Go / web /
 * single-screen devices) — callers null-check.
 */
export type CustomerDisplayModule = {
  present(): Promise<void>;
  dismiss(): Promise<void>;
  isPresenting(): Promise<boolean>;
};

const CustomerDisplayNative = requireOptionalNativeModule<CustomerDisplayModule>("CustomerDisplay");

export default CustomerDisplayNative;
