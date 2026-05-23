import { api } from "./api";

export type Outlet = { id: string; name: string };

export function fetchOutlets() {
  return api<Outlet[]>("/api/outlets", { auth: false });
}
