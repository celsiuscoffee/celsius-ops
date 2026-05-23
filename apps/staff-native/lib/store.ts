import { create } from "zustand";
import type { StaffSession } from "./session";

type State = {
  session: StaffSession | null;
  setSession: (s: StaffSession | null) => void;
};

export const useStaff = create<State>((set) => ({
  session: null,
  setSession: (s) => set({ session: s }),
}));
