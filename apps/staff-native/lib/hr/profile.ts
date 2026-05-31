import { api } from "../api";

export type Profile = {
  date_of_birth: string | null;
  gender: string | null;
  race: string | null;
  religion: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postcode: string | null;
  marital_status: string | null;
  spouse_name: string | null;
  spouse_working: boolean | null;
  num_children: number | null;
  education_level: string | null;
  t_shirt_size: string | null;
  dietary_restrictions: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  personal_email: string | null;
  secondary_phone: string | null;
  profile_completed_at?: string | null;
};

export type ProfileResponse = {
  profile: Profile;
  completeness: {
    filled: number;
    total: number;
    percent: number;
    complete: boolean;
  };
};

export function fetchProfile() {
  return api<ProfileResponse>("/api/hr/profile");
}

export function saveProfile(fields: Partial<Profile>, mark_complete = false) {
  return api<{ profile: Profile }>("/api/hr/profile", {
    method: "PATCH",
    body: JSON.stringify({ fields, mark_complete }),
  });
}
