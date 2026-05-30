import { AppRegistry } from "react-native";
import CustomerDisplay from "@/app/customer-display";

/**
 * Registers a SECOND React root component ("customerDisplay") that the
 * native CustomerDisplay Presentation module mounts onto the SUNMI's
 * secondary physical screen. It renders the same customer-display screen
 * the register feeds via the shared zustand stores — so it mirrors the
 * cart/member/status with no network hop.
 *
 * Imported for its side-effect from app/_layout.tsx so the registration
 * runs once at JS startup, before the native module asks for the surface.
 */
AppRegistry.registerComponent("customerDisplay", () => CustomerDisplay);
